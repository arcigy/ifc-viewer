import * as THREE from "three";
import { IFCLoader } from "web-ifc-three/IFCLoader";
import {
  acceleratedRaycast,
  computeBoundsTree,
  disposeBoundsTree,
} from "three-mesh-bvh";

export interface LoadingProgress {
  loaded: number;
  total: number;
  percentage: number;
  status: string;
}

export type ProgressCallback = (progress: LoadingProgress) => void;

export class IFCManager {
  private loaderReady: Promise<void>;
  private loader: IFCLoader;
  private scene: THREE.Scene;
  private currentModel: THREE.Object3D | null = null;
  private highlightMaterial: THREE.MeshBasicMaterial;
  private edgeMaterial: THREE.LineBasicMaterial;
  private currentSubset: THREE.Mesh | null = null;

  constructor(scene: THREE.Scene) {
    this.scene = scene;
    this.loader = new IFCLoader();
    this.loaderReady = this.setupLoader();

    // Create highlight material for subsets
    this.highlightMaterial = new THREE.MeshBasicMaterial({
      color: 0x00aaff,
      transparent: true,
      opacity: 0.6,
      depthTest: true,
    });

    // Create material for element edges (BIM style)
    this.edgeMaterial = new THREE.LineBasicMaterial({
      color: 0x444444,
      linewidth: 1,
      transparent: true,
      opacity: 0.3,
    });
  }

  private async setupLoader() {
    // We use a local wasm folder with version-matched files (0.0.39).
    const wasmPath = "/wasm/";
    
    // 1. Enable workers first (must be local to avoid SecurityError)
    await this.loader.ifcManager.useWebWorkers(true, "/wasm/IFCWorker.js");
    
    // 2. Set WASM path (the worker will search for web-ifc.wasm in this folder)
    this.loader.ifcManager.setWasmPath(wasmPath);

    console.log("IFC Engine initialized: Local Worker and WASM (0.0.39)");
    console.log("WASM folder:", wasmPath);

    // Optimize for large files
    try {
      this.loader.ifcManager.setupThreeMeshBVH(
        computeBoundsTree,
        disposeBoundsTree,
        acceleratedRaycast,
      );
    } catch (e) {
      console.warn(
        "Could not setup ThreeMeshBVH. Performance might be reduced.",
        e,
      );
    }
  }

  /**
   * Dispose of the current model to free up memory
   */
  private disposeCurrentModel() {
    if (this.currentModel) {
      console.log("Disposing previous model...");
      this.scene.remove(this.currentModel);

      // Traverse and dispose geometries and materials
      this.currentModel.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          if (child.geometry) {
            child.geometry.dispose();
          }
          if (child.material) {
            if (Array.isArray(child.material)) {
              child.material.forEach((material) => material.dispose());
            } else {
              child.material.dispose();
            }
          }
        }
      });

      this.currentModel = null;
    }
  }

  public async loadIFC(url: string, onProgress?: ProgressCallback) {
    // Wait for the engine to be fully initialized (workers and WASM path)
    await this.loaderReady;
    try {
      // Dispose previous model before loading new one
      this.disposeCurrentModel();

      // Update status
      if (onProgress) {
        onProgress({
          loaded: 0,
          total: 100,
          percentage: 0,
          status: "Starting download...",
        });
      }

      // Load the IFC model with progress tracking
      const ifcModel = await new Promise<THREE.Object3D>((resolve, reject) => {
        this.loader.load(
          url,
          // onLoad
          (model: THREE.Object3D) => {
            resolve(model);
          },
          // onProgress
          (event: ProgressEvent) => {
            if (onProgress && event.lengthComputable) {
              const percentage = Math.round((event.loaded / event.total) * 100);
              onProgress({
                loaded: event.loaded,
                total: event.total,
                percentage: percentage,
                status:
                  percentage < 100
                    ? "Downloading..."
                    : "Processing geometry...",
              });
            }
          },
          // onError
          (error: unknown) => {
            console.error("IFCLoader error:", error);
            reject(new Error(`IFC Loader failed: ${error}`));
          },
        );
      });

      // Add to scene
      this.scene.add(ifcModel);
      this.currentModel = ifcModel;

      // PERFORMANCE FIX: Center geometry to origin to prevent jitter
      // This is critical for models with large coordinates (georeferenced)
      this.centerModel(ifcModel);

      // Final progress update
      if (onProgress) {
        onProgress({
          loaded: 100,
          total: 100,
          percentage: 100,
          status: "Complete!",
        });
      }

      console.log("IFC Model loaded successfully and centered", ifcModel);

      // Add BIM edges for better visibility
      this.setupEdges(ifcModel);

      return ifcModel;
    } catch (error) {
      console.error("Error loading IFC model:", error);

      if (onProgress) {
        onProgress({
          loaded: 0,
          total: 100,
          percentage: 0,
          status: "Error loading model",
        });
      }

      throw error;
    }
  }

  /**
   * Center the model's geometry to [0,0,0] to solve precision issues (jitter)
   */
  private centerModel(model: THREE.Object3D) {
    try {
      // Update the model's matrix world to ensure positions are correct
      model.updateMatrixWorld(true);

      // Find all meshes to compute the overall bounding box
      const meshes: THREE.Mesh[] = [];
      model.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          meshes.push(child);
        }
      });

      if (meshes.length === 0) {
        console.warn("No meshes found in model to center");
        return;
      }

      // Compute overall bounding box
      const bbox = new THREE.Box3();
      meshes.forEach((mesh) => {
        if (mesh.geometry) {
          mesh.geometry.computeBoundingBox();
          if (mesh.geometry.boundingBox) {
            const meshBox = mesh.geometry.boundingBox.clone();
            meshBox.applyMatrix4(mesh.matrixWorld);
            bbox.union(meshBox);
          }
        }
      });

      if (bbox.isEmpty()) {
        console.warn("Computed bounding box is empty");
        return;
      }

      // Calculate center
      const center = new THREE.Vector3();
      bbox.getCenter(center);

      console.log("Centering model geometry from origin:", center);

      // CRITICAL FIX FOR JITTERING:
      // Instead of moving the model container (model.position),
      // we shift the actual vertex data in the geometry.
      // This keeps vertex coordinates small, which prevents GPU precision issues.
      meshes.forEach((mesh) => {
        if (mesh.geometry) {
          mesh.geometry.translate(-center.x, -center.y, -center.z);
          mesh.geometry.computeBoundingBox();
          mesh.geometry.computeBoundingSphere();
        }
      });

      // Reset model position if it was changed
      model.position.set(0, 0, 0);

      // Store the offset on the model for reference if needed
      (model as any).offset = center.clone();

      // Re-update matrix world after shifting
      model.updateMatrixWorld(true);
    } catch (error) {
      console.error("Error during model centering:", error);
    }
  }

  /**
   * Setup edge outlines for all meshes in the model (BIM style)
   */
  private setupEdges(model: THREE.Object3D) {
    model.traverse((child) => {
      if (child instanceof THREE.Mesh && child.geometry) {
        // Adjust material for better look
        if (child.material) {
          const materials = Array.isArray(child.material)
            ? child.material
            : [child.material];
          materials.forEach((mat) => {
            if (
              mat instanceof THREE.MeshStandardMaterial ||
              mat instanceof THREE.MeshPhongMaterial
            ) {
              mat.polygonOffset = true;
              mat.polygonOffsetFactor = 1;
              mat.polygonOffsetUnits = 1;
            }
          });
        }

        // Create edges
        const edgesGeometry = new THREE.EdgesGeometry(child.geometry, 25); // 25 degree threshold
        const edges = new THREE.LineSegments(edgesGeometry, this.edgeMaterial);

        // Add as child so it moves with the mesh
        child.add(edges);
      }
    });
  }

  /**
   * Load IFC from a File object
   */
  public async loadFile(file: File, onProgress?: ProgressCallback) {
    const url = URL.createObjectURL(file);

    try {
      const model = await this.loadIFC(url, onProgress);
      return model;
    } finally {
      // Clean up the object URL after loading
      URL.revokeObjectURL(url);
    }
  }

  /**
   * Get the currently loaded model
   */
  public getCurrentModel(): THREE.Object3D | null {
    return this.currentModel;
  }

  /**
   * Get properties of an IFC element - COMPREHENSIVE VERSION
   */
  public async getElementProperties(mesh: THREE.Mesh): Promise<any> {
    try {
      // Get the express ID from the mesh
      const expressID = (mesh as any).expressID;
      if (expressID === undefined) {
        console.warn("Mesh does not have an expressID");
        return null;
      }

      // Get the model ID (usually 0 for single model)
      const modelID = (mesh as any).modelID || 0;

      console.log(`Deep extraction for ID: ${expressID}, model: ${modelID}`);

      // 1. Get basic properties
      const properties = await this.loader.ifcManager.getItemProperties(
        modelID,
        expressID,
      );

      // 2. Get property sets (true = including quantities)
      const propertySets = await this.loader.ifcManager.getPropertySets(
        modelID,
        expressID,
        true,
      );

      // 3. Get material properties
      let materials = [];
      try {
        // materials = await this.loader.ifcManager.getMaterialsProperties(modelID, expressID); // Some versions of web-ifc-three
        // If not available, we find them in properties.HasAssociations
        if (properties.HasAssociations) {
          for (const assoc of properties.HasAssociations) {
            const assocProps = await this.loader.ifcManager.getItemProperties(
              modelID,
              assoc.value,
            );
            if (assocProps.type === "IFCMATERIAL" || assocProps.Name) {
              materials.push(assocProps);
            }
          }
        }
      } catch (e) {
        console.warn("Materials not found");
      }

      // 4. Get Type properties (if available)
      let typeProperties = null;
      if (properties.type) {
        try {
          typeProperties = await this.loader.ifcManager.getItemProperties(
            modelID,
            properties.type,
          );
          // Also get Psets for the type
          try {
            const typePsets = await this.loader.ifcManager.getPropertySets(
              modelID,
              properties.type,
              true,
            );
            (typeProperties as any).propertySets = typePsets;
          } catch (psetError) {
            console.warn("Could not get Psets for type");
          }
        } catch (e) {
          console.warn("Type properties not found");
        }
      }

      // 5. Fallback: If propertySets is empty, try to manually find them in associations
      if (
        (!propertySets || propertySets.length === 0) &&
        properties.HasAssociations
      ) {
        console.log("Manually searching for property sets in associations...");
        for (const assoc of properties.HasAssociations) {
          try {
            const assocProps = await this.loader.ifcManager.getItemProperties(
              modelID,
              assoc.value,
            );
            // IFCPROPERTYSET or IFCELEMENTQUANTITY
            if (
              assocProps.type === "IFCPROPERTYSET" ||
              assocProps.type === "IFCELEMENTQUANTITY"
            ) {
              const fullSet = await this.loader.ifcManager.getItemProperties(
                modelID,
                assocProps.expressID,
              );
              propertySets.push(fullSet);
            }
          } catch (e) {
            /* Ignore fallback errors */
          }
        }
      }

      return {
        properties,
        propertySets,
        materials,
        typeProperties,
        expressID,
        modelID,
      };
    } catch (error) {
      console.error("Error in deep property extraction:", error);
      return null;
    }
  }

  /**
   * Get the type name of an IFC element
   */
  public getElementType(properties: any): string {
    if (!properties) return "Unknown";

    // Try to get the type from the properties
    const type =
      properties.type?.value || properties.constructor?.name || "IFC Element";

    // Clean up the type name (remove "Ifc" prefix if present)
    return type
      .replace(/^Ifc/, "")
      .replace(/([A-Z])/g, " $1")
      .trim();
  }

  /**
   * Get the loader instance (for advanced usage)
   */
  public getLoader(): IFCLoader {
    return this.loader;
  }

  /**
   * Highlight a specific IFC element by creating a subset
   */
  public highlightElement(modelID: number, expressID: number) {
    // Remove previous highlight
    this.removeHighlight();

    if (!this.currentModel) return;

    try {
      // Create subset for the selected element
      const subset = this.loader.ifcManager.createSubset({
        modelID: modelID,
        ids: [expressID],
        material: this.highlightMaterial,
        scene: this.scene,
        removePrevious: true,
      });

      // CRITICAL FIX: The subset is created from original IFC coordinates.
      // If the main model was centered/translated, the subset must be too.
      const offset = (this.currentModel as any).offset;
      if (offset && subset.geometry) {
        subset.geometry.translate(-offset.x, -offset.y, -offset.z);
      }

      this.currentSubset = subset;
    } catch (error) {
      console.error("Error creating highlight subset:", error);
    }
  }

  /**
   * Remove highlight from selected element
   */
  public removeHighlight() {
    if (this.currentSubset) {
      try {
        const modelID = (this.currentSubset as any).modelID || 0;
        this.loader.ifcManager.removeSubset(modelID, this.highlightMaterial);
        this.currentSubset = null;
      } catch (error) {
        console.error("Error removing highlight:", error);
      }
    }
  }
}
