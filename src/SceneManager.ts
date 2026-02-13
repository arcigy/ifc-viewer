import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

export class SceneManager {
    private container: HTMLElement;
    private renderer: THREE.WebGLRenderer;
    private scene: THREE.Scene;
    private camera: THREE.PerspectiveCamera;
    private controls: OrbitControls;
    private lastMiddleClickTime: number = 0;
    private readonly DOUBLE_CLICK_DELAY = 300; // ms

    // Raycasting for element picking
    private raycaster: THREE.Raycaster;
    private mouse: THREE.Vector2;
    private selectedObject: THREE.Object3D | null = null;
    private onObjectSelectedCallback?: (object: THREE.Object3D | null) => void;

    constructor(containerId: string) {
        const container = document.getElementById(containerId);
        if (!container) throw new Error(`Container with id '${containerId}' not found.`);
        this.container = container;

        // Initialize raycaster and mouse
        this.raycaster = new THREE.Raycaster();
        this.mouse = new THREE.Vector2();

        // 1. Setup Scene
        this.scene = new THREE.Scene();
        // BIM-style background: light blue sky gradient look
        this.scene.background = new THREE.Color(0xe8f1f5);
        this.scene.fog = new THREE.Fog(0xe8f1f5, 100000, 2000000);

        // 2. Setup Camera
        this.camera = new THREE.PerspectiveCamera(
            45,
            this.container.clientWidth / this.container.clientHeight,
            10, // Increased near plane slightly for better precision at scale
            2000000 // Increased far plane to 2km for mm scale
        );
        this.camera.position.set(20, 20, 20);

        // 3. Setup Renderer
        this.renderer = new THREE.WebGLRenderer({
            antialias: true,
            alpha: true,
            preserveDrawingBuffer: true
        });
        this.renderer.setSize(this.container.clientWidth, this.container.clientHeight);
        this.renderer.setPixelRatio(window.devicePixelRatio);
        this.renderer.shadowMap.enabled = true;
        this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        this.renderer.outputColorSpace = THREE.SRGBColorSpace;
        this.container.appendChild(this.renderer.domElement);

        // 4. Setup Controls (OrbitControls) - "BIM-like" - OPTIMIZED
        this.controls = new OrbitControls(this.camera, this.renderer.domElement);
        this.controls.enableDamping = true;
        this.controls.dampingFactor = 0.05;
        this.controls.screenSpacePanning = true;
        this.controls.minDistance = 10; // Minimum zoom
        this.controls.maxDistance = 1000000; // Maximum zoom
        this.controls.update();

        // 5. Setup Lights & Environment
        this.setupEnvironment();

        // 6. Handle Resize
        window.addEventListener('resize', this.onWindowResize.bind(this));

        // 7. Setup double middle-click for fit-to-view
        this.setupFitToView();

        // 8. Setup element picking
        this.setupElementPicking();

        // Start Animation Loop
        this.animate();
    }

    private setupEnvironment() {
        // 1. Hemisphere Light (Sky and Ground ambient)
        const hemiLight = new THREE.HemisphereLight(0xffffff, 0x444444, 0.8);
        hemiLight.position.set(0, 100000, 0);
        this.scene.add(hemiLight);

        // 2. Main Directional Light (Sun)
        const sunLight = new THREE.DirectionalLight(0xffffff, 0.8);
        sunLight.position.set(100000, 200000, 100000);
        sunLight.castShadow = true;

        // Optimize shadow camera for large scenes
        sunLight.shadow.camera.left = -50000;
        sunLight.shadow.camera.right = 50000;
        sunLight.shadow.camera.top = 50000;
        sunLight.shadow.camera.bottom = -50000;
        sunLight.shadow.mapSize.width = 2048;
        sunLight.shadow.mapSize.height = 2048;
        this.scene.add(sunLight);

        // 3. Fill Lights (to prevent pitch black areas - standard in BIM)
        const fillLight1 = new THREE.DirectionalLight(0xffffff, 0.4);
        fillLight1.position.set(-100000, 50000, -100000);
        this.scene.add(fillLight1);

        const fillLight2 = new THREE.DirectionalLight(0xffffff, 0.2);
        fillLight2.position.set(0, -50000, 0);
        this.scene.add(fillLight2);

        // Grid Helper - Subtle gray
        const gridHelper = new THREE.GridHelper(200000, 100, 0xcccccc, 0xdddddd);
        gridHelper.position.y = -10; // Slightly below zero to avoid z-fighting
        this.scene.add(gridHelper);

        // Axes Helper
        const axesHelper = new THREE.AxesHelper(5000);
        this.scene.add(axesHelper);
    }

    private onWindowResize() {
        if (!this.container) return;
        this.camera.aspect = this.container.clientWidth / this.container.clientHeight;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(this.container.clientWidth, this.container.clientHeight);
    }

    private animate() {
        requestAnimationFrame(this.animate.bind(this));
        this.controls.update();
        this.renderer.render(this.scene, this.camera);
    }

    public getScene(): THREE.Scene {
        return this.scene;
    }

    public getCamera(): THREE.Camera {
        return this.camera;
    }

    /**
     * Setup double middle-click listener for fit-to-view
     */
    private setupFitToView() {
        this.renderer.domElement.addEventListener('mousedown', (event) => {
            // Middle mouse button (wheel click) = button 1
            if (event.button === 1) {
                event.preventDefault();

                const currentTime = Date.now();
                const timeSinceLastClick = currentTime - this.lastMiddleClickTime;

                if (timeSinceLastClick < this.DOUBLE_CLICK_DELAY) {
                    // Double click detected
                    this.fitCameraToModel();
                    this.lastMiddleClickTime = 0; // Reset
                } else {
                    this.lastMiddleClickTime = currentTime;
                }
            }
        });
    }

    /**
     * Fit camera to view the entire model
     */
    public fitCameraToModel() {
        // Calculate bounding box of all objects in scene
        const box = new THREE.Box3();

        this.scene.traverse((object) => {
            // Skip helpers and lights
            if (object instanceof THREE.Mesh) {
                box.expandByObject(object);
            }
        });

        // Check if box is valid
        if (box.isEmpty()) {
            console.warn('No objects to fit camera to');
            return;
        }

        const center = box.getCenter(new THREE.Vector3());
        const size = box.getSize(new THREE.Vector3());

        // Calculate the maximum dimension
        const maxDim = Math.max(size.x, size.y, size.z);
        const fov = this.camera.fov * (Math.PI / 180);
        let cameraZ = Math.abs(maxDim / 2 / Math.tan(fov / 2));

        // Add some padding (multiply by 1.5 for better view)
        cameraZ *= 1.5;

        // Calculate camera position (from center, looking at center)
        const direction = new THREE.Vector3();
        this.camera.getWorldDirection(direction);

        const newPosition = new THREE.Vector3(
            center.x - direction.x * cameraZ,
            center.y - direction.y * cameraZ + maxDim * 0.3, // Slightly elevated
            center.z - direction.z * cameraZ
        );

        // Animate camera to new position
        this.animateCamera(newPosition, center);
    }

    /**
     * Animate camera to new position and target
     */
    private animateCamera(targetPosition: THREE.Vector3, targetLookAt: THREE.Vector3) {
        const startPosition = this.camera.position.clone();
        const startTarget = this.controls.target.clone();
        const duration = 1000; // ms
        const startTime = Date.now();

        const animate = () => {
            const elapsed = Date.now() - startTime;
            const progress = Math.min(elapsed / duration, 1);

            // Easing function (ease-in-out)
            const eased = progress < 0.5
                ? 2 * progress * progress
                : 1 - Math.pow(-2 * progress + 2, 2) / 2;

            // Interpolate position
            this.camera.position.lerpVectors(startPosition, targetPosition, eased);

            // Interpolate target
            this.controls.target.lerpVectors(startTarget, targetLookAt, eased);
            this.controls.update();

            if (progress < 1) {
                requestAnimationFrame(animate);
            }
        };

        animate();
    }

    /**
     * Setup element picking with raycasting
     */
    private setupElementPicking() {
        this.renderer.domElement.addEventListener('click', (event) => {
            // Ignore if middle or right button
            if (event.button !== 0) return;

            // Calculate mouse position in normalized device coordinates
            const rect = this.renderer.domElement.getBoundingClientRect();
            this.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
            this.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

            // Pick object
            this.pickObject();
        });
    }

    /**
     * Pick object using raycaster
     */
    private pickObject() {
        // Update raycaster
        this.raycaster.setFromCamera(this.mouse, this.camera);

        // Get all meshes in the scene (excluding helpers)
        const meshes: THREE.Mesh[] = [];
        this.scene.traverse((object) => {
            if (object instanceof THREE.Mesh && object.visible) {
                // Exclude helpers (grid, axes)
                if (!object.name.includes('Helper') && !object.name.includes('Grid')) {
                    meshes.push(object);
                }
            }
        });

        // Find intersections
        const intersects = this.raycaster.intersectObjects(meshes, false);

        if (intersects.length > 0) {
            const intersection = intersects[0];
            const pickedMesh = intersection.object as THREE.Mesh;

            // For IFC models, we need to get the specific element using face index
            // The IFC loader stores expressID in the geometry's index attribute
            if (intersection.faceIndex != null && pickedMesh.geometry) {
                const geometry = pickedMesh.geometry;
                const index = geometry.index;

                if (index) {
                    // Get the face index (each face has 3 vertices)
                    const faceIndex = intersection.faceIndex * 3;

                    // Try to get expressID from the geometry attributes
                    // IFC loader stores expressID per vertex
                    const expressIDAttr = geometry.attributes['expressID'];

                    if (expressIDAttr) {
                        // Get expressID from the first vertex of the face
                        const vertexIndex = index.getX(faceIndex);
                        const expressID = expressIDAttr.getX(vertexIndex);

                        // Store expressID on the mesh for later retrieval
                        (pickedMesh as any).expressID = expressID;
                        (pickedMesh as any).modelID = (pickedMesh.parent as any)?.modelID || 0;
                    }
                }
            }

            this.selectObject(pickedMesh);
        } else {
            this.deselectObject();
        }
    }

    /**
     * Select an object and notify callback
     * Note: Visual highlighting is now handled by IFC subset in IFCManager
     */
    private selectObject(object: THREE.Object3D) {
        // Deselect previous object
        this.deselectObject();

        this.selectedObject = object;

        // Notify callback (highlighting is done in main.ts via IFCManager)
        if (this.onObjectSelectedCallback) {
            this.onObjectSelectedCallback(object);
        }
    }

    /**
     * Deselect current object
     */
    private deselectObject() {
        this.selectedObject = null;

        // Notify callback
        if (this.onObjectSelectedCallback) {
            this.onObjectSelectedCallback(null);
        }
    }

    /**
     * Set callback for object selection
     */
    public onObjectSelected(callback: (object: THREE.Object3D | null) => void) {
        this.onObjectSelectedCallback = callback;
    }

    /**
     * Get currently selected object
     */
    public getSelectedObject(): THREE.Object3D | null {
        return this.selectedObject;
    }
}
