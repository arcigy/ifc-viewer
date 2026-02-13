// Type declarations for three.js IFCLoader
declare module 'three/examples/jsm/loaders/IFCLoader.js' {
    import * as THREE from 'three';

    export class IFCLoader extends THREE.Loader {
        ifcManager: {
            setWasmPath(path: string): void;
            setupThreeMeshBVH(): void;
            getItemProperties(modelID: number, expressID: number): Promise<any>;
            getPropertySets(modelID: number, expressID: number, recursive?: boolean): Promise<any>;
            getSpatialStructure(modelID: number): Promise<any>;
            createSubset(config: {
                modelID: number;
                ids: number[];
                material?: THREE.Material;
                scene: THREE.Scene;
                removePrevious?: boolean;
            }): THREE.Mesh;
            removeSubset(modelID: number, material?: THREE.Material): void;
        };

        load(
            url: string,
            onLoad: (object: THREE.Object3D) => void,
            onProgress?: (event: ProgressEvent) => void,
            onError?: (error: unknown) => void
        ): void;

        loadAsync(url: string): Promise<THREE.Object3D>;
    }
}
