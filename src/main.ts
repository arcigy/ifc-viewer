import './style.css'
import { SceneManager } from './SceneManager';
import { IFCManager } from './IFCManager';
import { PropertiesPanel, type IFCPropertyGroup } from './PropertiesPanel';
import { ValidationPanel } from './ValidationPanel';
import { PropertyValidator } from './PropertyValidator';
import type { LoadingProgress } from './IFCManager';
import * as THREE from 'three';

document.addEventListener('DOMContentLoaded', () => {
  // UI Elements
  const loadingOverlay = document.getElementById('loading-overlay') as HTMLElement;
  const progressBar = document.getElementById('progress-bar') as HTMLElement;
  const loadingPercentage = document.getElementById('loading-percentage') as HTMLElement;
  const loadingStatus = document.getElementById('loading-status') as HTMLElement;
  const fileInput = document.getElementById('file-input') as HTMLInputElement;
  const toggleValidationBtn = document.getElementById('toggle-validation') as HTMLButtonElement;

  // Managers
  const sceneManager = new SceneManager('three-canvas-container');
  const ifcManager = new IFCManager(sceneManager.getScene());
  const propertiesPanel = new PropertiesPanel('properties-panel');
  const validationPanel = new ValidationPanel('validation-panel');
  const propertyValidator = new PropertyValidator(ifcManager);

  // Progress callback function
  const updateProgress = (progress: LoadingProgress) => {
    if (progressBar) progressBar.style.width = `${progress.percentage}%`;
    if (loadingStatus) loadingStatus.textContent = progress.status;
    if (loadingPercentage) loadingPercentage.textContent = `${progress.percentage}%`;
  };

  const showLoading = () => {
    if (loadingOverlay) loadingOverlay.classList.remove('hidden');
  };

  const hideLoading = () => {
    if (loadingOverlay) {
      setTimeout(() => {
        loadingOverlay.classList.add('hidden');
      }, 500);
    }
  };

  // --- Validation Logic ---

  // Toggle Validation Panel
  if (toggleValidationBtn) {
    toggleValidationBtn.addEventListener('click', () => {
      const valPanel = document.getElementById('validation-panel');
      const propPanel = document.getElementById('properties-panel');

      if (valPanel && propPanel) {
        if (valPanel.classList.contains('hidden')) {
          valPanel.classList.remove('hidden');
          propPanel.classList.add('hidden');
          validationPanel.setVisible(true);
          toggleValidationBtn.classList.add('active'); // Optional styling
        } else {
          valPanel.classList.add('hidden');
          propPanel.classList.remove('hidden');
          validationPanel.setVisible(false);
          toggleValidationBtn.classList.remove('active');
        }
      }
    });
  }

  // Run Validation
  validationPanel.onValidate(async (rules) => {
    if (!ifcManager.getCurrentModel()) {
      alert("Please load an IFC model first.");
      return;
    }

    showLoading();
    loadingStatus.textContent = "Validating...";

    // Allow UI to update
    await new Promise(r => setTimeout(r, 100));

    try {
      const results = await propertyValidator.validateModel(rules, (percent) => {
        if (progressBar) progressBar.style.width = `${percent}%`;
        if (loadingPercentage) loadingPercentage.textContent = `${percent}%`;
      });

      validationPanel.showResults(results);
    } catch (error) {
      console.error("Validation error:", error);
      alert("Error during validation. Check console.");
    } finally {
      hideLoading();
    }
  });

  // Highlight from Validation Report
  validationPanel.onSelect((id, modelID) => {
    ifcManager.highlightElement(modelID, id);
  });

  // --- Standard Selection (Properties) ---
  sceneManager.onObjectSelected(async (object) => {
    if (!object || !(object instanceof THREE.Mesh)) {
      propertiesPanel.clear();
      ifcManager.removeHighlight();
      return;
    }

    try {
      // Only show properties if properties panel is visible
      const propPanelMode = !document.getElementById('properties-panel')?.classList.contains('hidden');

      // Highlight (always)
      const expressID = (object as any).expressID;
      const modelID = (object as any).modelID || 0;
      if (expressID !== undefined) {
        ifcManager.highlightElement(modelID, expressID);
      }

      if (propPanelMode) {
        propertiesPanel.showLoading();
        const elementData = await ifcManager.getElementProperties(object);

        if (!elementData) {
          propertiesPanel.showError('No properties available for this element');
          return;
        }

        // Format properties
        const propertyGroups: IFCPropertyGroup[] = [];

        if (elementData.properties) {
          const basicProps: IFCPropertyGroup = { name: 'Basic Information', properties: [] };
          basicProps.properties.push({ name: 'Express ID', value: elementData.expressID });
          basicProps.properties.push({ name: 'Class', value: ifcManager.getElementType(elementData.properties) });

          for (const [key, value] of Object.entries(elementData.properties)) {
            if (['expressID', 'type', 'HasAssignments', 'HasAssociations', 'IsDefinedBy', 'IsDecomposedBy'].includes(key)) continue;
            if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
              basicProps.properties.push({ name: key, value: value });
            } else if (value && typeof value === 'object' && 'value' in (value as any)) {
              basicProps.properties.push({ name: key, value: (value as any).value });
            }
          }
          propertyGroups.push(basicProps);
        }

        // Psets
        if (elementData.propertySets) {
          elementData.propertySets.forEach((pset: any) => {
            if (!pset) return;
            const group: IFCPropertyGroup = { name: pset.Name?.value || 'Properties', properties: [] };

            if (pset.HasProperties) {
              pset.HasProperties.forEach((prop: any) => {
                if (prop?.Name && prop?.NominalValue) {
                  group.properties.push({ name: prop.Name.value, value: prop.NominalValue.value });
                }
              });
            }
            // Quantities
            if (pset.Quantities) {
              pset.Quantities.forEach((q: any) => {
                if (q?.Name) {
                  const val = q.AreaValue?.value || q.VolumeValue?.value || q.CountValue?.value || q.LengthValue?.value || q.WeightValue?.value || 'N/A';
                  group.properties.push({ name: q.Name.value, value: val });
                }
              });
            }
            if (group.properties.length > 0) propertyGroups.push(group);
          });
        }

        // Materials
        if (elementData.materials) {
          const matGroup: IFCPropertyGroup = { name: 'Materials', properties: [] };
          elementData.materials.forEach((mat: any) => {
            if (mat?.Name) matGroup.properties.push({ name: 'Material', value: mat.Name.value });
          });
          if (matGroup.properties.length > 0) propertyGroups.push(matGroup);
        }

        propertiesPanel.displayProperties(ifcManager.getElementType(elementData.properties), propertyGroups);
      }
    } catch (error) {
      console.error('Error displaying properties:', error);
      propertiesPanel.showError('Error loading properties');
    }
  });

  // File input handler
  if (fileInput) {
    fileInput.addEventListener('change', async (event) => {
      const target = event.target as HTMLInputElement;
      if (target.files && target.files.length > 0) {
        const file = target.files[0];
        console.log('Loading file:', file.name);
        showLoading();
        try {
          await ifcManager.loadFile(file, updateProgress);
          setTimeout(() => sceneManager.fitCameraToModel(), 100);
        } catch (error) {
          console.error('Failed to load model:', error);
          alert('Failed to load IFC model.');
        } finally {
          hideLoading();
        }
      }
    });
  }
});
