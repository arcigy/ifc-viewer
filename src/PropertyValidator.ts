import * as THREE from 'three';
import { IFCManager } from './IFCManager';

export interface ValidationRule {
    ifcClass: string; // e.g. "IFCWALL" or "Wall"
    requiredPsets: string[]; // e.g. ["Pset_WallCommon"]
    requiredProperties: { [psetName: string]: string[] }; // e.g. { "Pset_WallCommon": ["LoadBearing"] }
}

export interface ValidationResult {
    elementID: number;
    modelID: number;
    ifcClass: string;
    missingPsets: string[];
    missingProperties: { [psetName: string]: string[] };
    passed: boolean;
}

export class PropertyValidator {
    private ifcManager: IFCManager;

    constructor(ifcManager: IFCManager) {
        this.ifcManager = ifcManager;
    }

    /**
     * Validate the current model against the provided rules.
     */
    public async validateModel(rules: ValidationRule[], onProgress?: (percent: number) => void): Promise<ValidationResult[]> {
        const model = this.ifcManager.getCurrentModel();
        if (!model) {
            console.warn("No model loaded to validate.");
            return [];
        }

        const results: ValidationResult[] = [];
        const meshes: THREE.Mesh[] = [];

        // 1. Collect all meshes from the model
        model.traverse((child) => {
            if (child instanceof THREE.Mesh && (child as any).expressID !== undefined) {
                meshes.push(child);
            }
        });

        const total = meshes.length;
        let processed = 0;

        console.log(`Starting validation on ${total} elements...`);

        // 2. Validate each mesh
        // Note: processing sequentially to avoid overwhelming the loader/worker
        for (const mesh of meshes) {
            const result = await this.validateElement(mesh, rules);
            if (result && !result.passed) {
                results.push(result);
            }

            processed++;
            if (onProgress && processed % 10 === 0) {
                onProgress(Math.round((processed / total) * 100));
            }
        }

        if (onProgress) onProgress(100);
        return results;
    }

    /**
     * Validate a single element against all rules
     */
    private async validateElement(mesh: THREE.Mesh, rules: ValidationRule[]): Promise<ValidationResult | null> {
        try {
            // Get all properties for the element (lightweight first, then deep if needed?)
            // Actually, for validation we need Psets, so we need the deep fetch or at least Psets.
            // basic properties include the type.

            // Optimization: Get basic properties first to check type
            const expressID = (mesh as any).expressID;
            const modelID = (mesh as any).modelID || 0;

            // Use the loader directly for speed if possible, but IFCManager wraps it well.
            // We use a simplified property fetch first to check the Class.
            // Note: writing a custom fetch here might be faster than the full getElementProperties
            // but for now, let's reuse logic or access loader.

            // Helper to get type property
            const loader = this.ifcManager.getLoader();
            const props = await loader.ifcManager.getItemProperties(modelID, expressID);

            // Determine IFC Class (e.g. "IFCWALLSTANDARDCASE" or just "IFCWALL")
            // allow matching "IFCWALL" to "IFCWALLSTANDARDCASE" if needed, but let's be strict or contains-based.
            const ifcType = props.type || (props.constructor ? props.constructor.name : "");
            const normalizedType = ifcType.toUpperCase();

            // Find applicable rules
            const applicableRules = rules.filter(r => normalizedType.includes(r.ifcClass.toUpperCase()));

            if (applicableRules.length === 0) {
                return null; // No rules for this element type
            }

            // If we have rules, we need the Property Sets
            const propertySets = await loader.ifcManager.getPropertySets(modelID, expressID, true);

            const missingPsets: string[] = [];
            const missingProperties: { [psetName: string]: string[] } = {};
            let hasError = false;

            for (const rule of applicableRules) {
                // Check missing Psets
                for (const reqPset of rule.requiredPsets) {
                    const foundPset = propertySets.find((ps: any) => ps.Name && ps.Name.value === reqPset);
                    if (!foundPset) {
                        if (!missingPsets.includes(reqPset)) {
                            missingPsets.push(reqPset);
                        }
                        hasError = true;
                    }
                }

                // Check missing Properties
                for (const [psetName, reqProps] of Object.entries(rule.requiredProperties)) {
                    const foundPset = propertySets.find((ps: any) => ps.Name && ps.Name.value === psetName);

                    if (!foundPset) {
                        // Already handled in missingPsets, but we also can't check properties
                        // Maybe we explicitly list missing props too? 
                        // For now, if Pset is missing, we assume props are missing too?
                        // Let's just list the Pset as missing.
                        continue;
                    }

                    // Check properties within the Pset
                    // Pset structure: HasProperties array
                    if (foundPset.HasProperties) {
                        for (const propName of reqProps) {
                            const propExists = foundPset.HasProperties.some((p: any) => p.Name && p.Name.value === propName);
                            if (!propExists) {
                                if (!missingProperties[psetName]) missingProperties[psetName] = [];
                                if (!missingProperties[psetName].includes(propName)) {
                                    missingProperties[psetName].push(propName);
                                }
                                hasError = true;
                            }
                        }
                    } else {
                        // Empty Pset?
                        if (!missingProperties[psetName]) missingProperties[psetName] = [];
                        missingProperties[psetName].push(...reqProps);
                        hasError = true;
                    }
                }
            }

            if (!hasError) return { elementID: expressID, modelID, ifcClass: normalizedType, missingPsets: [], missingProperties: {}, passed: true };

            return {
                elementID: expressID,
                modelID,
                ifcClass: normalizedType,
                missingPsets,
                missingProperties,
                passed: false
            };

        } catch (e) {
            console.error(`Error validating element ${mesh.id}`, e);
            return null;
        }
    }
}
