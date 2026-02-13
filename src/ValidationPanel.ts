import type { ValidationResult, ValidationRule } from './PropertyValidator';

export class ValidationPanel {
    private container: HTMLElement;
    private rulesInput: HTMLTextAreaElement;
    private validateBtn: HTMLButtonElement;
    private resultsContainer: HTMLElement;
    private onValidateCallback?: (rules: ValidationRule[]) => void;
    private onSelectCallback?: (id: number, modelID: number) => void;

    // Default rules as requested by user
    private defaultRules: ValidationRule[] = [
        {
            ifcClass: "IFCWALL",
            requiredPsets: ["Pset_WallCommon"],
            requiredProperties: {
                "Pset_WallCommon": ["LoadBearing", "IsExternal"]
            }
        },
        {
            ifcClass: "IFCSLAB",
            requiredPsets: ["Pset_SlabCommon"],
            requiredProperties: {
                "Pset_SlabCommon": ["LoadBearing"]
            }
        }
    ];

    constructor(containerId: string) {
        const container = document.getElementById(containerId);
        if (!container) throw new Error(`Validation panel container '${containerId}' not found.`);
        this.container = container;

        this.rulesInput = document.getElementById('validation-rules') as HTMLTextAreaElement;
        this.validateBtn = document.getElementById('btn-validate') as HTMLButtonElement;
        this.resultsContainer = document.getElementById('validation-results') as HTMLElement;

        if (!this.rulesInput || !this.validateBtn || !this.resultsContainer) {
            throw new Error("Validation panel elements not found.");
        }

        // Initialize with default rules
        this.rulesInput.value = JSON.stringify(this.defaultRules, null, 2);

        this.setupEventListeners();
    }

    private setupEventListeners() {
        this.validateBtn.addEventListener('click', () => {
            try {
                const rules = JSON.parse(this.rulesInput.value);
                if (this.onValidateCallback) {
                    this.onValidateCallback(rules);
                }
            } catch (e) {
                alert("Invalid JSON format in rules.");
            }
        });
    }

    public setVisible(visible: boolean) {
        if (visible) {
            this.container.classList.remove('hidden');
        } else {
            this.container.classList.add('hidden');
        }
    }

    public showResults(results: ValidationResult[]) {
        this.resultsContainer.innerHTML = '';

        if (results.length === 0) {
            this.resultsContainer.innerHTML = '<div class="validation-item success">No errors found! Model is valid.</div>';
            return;
        }

        const summary = document.createElement('div');
        summary.style.marginBottom = '10px';
        summary.style.fontWeight = 'bold';
        summary.textContent = `Found ${results.length} issues:`;
        this.resultsContainer.appendChild(summary);

        results.forEach(result => {
            const item = document.createElement('div');
            item.className = 'validation-item error';

            // Header
            const header = document.createElement('div');
            header.className = 'validation-header';
            header.innerHTML = `
                <span class="validation-id">ID: ${result.elementID}</span>
                <span class="validation-class">${result.ifcClass}</span>
            `;
            item.appendChild(header);

            // Details
            const details = document.createElement('div');
            details.className = 'validation-details';

            // Missing Psets
            if (result.missingPsets.length > 0) {
                result.missingPsets.forEach(pset => {
                    const line = document.createElement('div');
                    line.className = 'validation-detail-item';
                    line.textContent = `Missing Pset: ${pset}`;
                    details.appendChild(line);
                });
            }

            // Missing Properties
            if (Object.keys(result.missingProperties).length > 0) {
                for (const [pset, props] of Object.entries(result.missingProperties)) {
                    props.forEach(prop => {
                        const line = document.createElement('div');
                        line.className = 'validation-detail-item';
                        line.textContent = `Missing Prop: ${pset}.${prop}`;
                        details.appendChild(line);
                    });
                }
            }

            item.appendChild(details);

            // Click event
            item.addEventListener('click', () => {
                if (this.onSelectCallback) {
                    this.onSelectCallback(result.elementID, result.modelID);
                }
            });

            this.resultsContainer.appendChild(item);
        });
    }

    public onValidate(callback: (rules: ValidationRule[]) => void) {
        this.onValidateCallback = callback;
    }

    public onSelect(callback: (id: number, modelID: number) => void) {
        this.onSelectCallback = callback;
    }
}
