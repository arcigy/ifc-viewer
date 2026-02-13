export interface IFCProperty {
    name: string;
    value: string | number | boolean;
    type?: string;
}

export interface IFCPropertyGroup {
    name: string;
    properties: IFCProperty[];
}

export class PropertiesPanel {
    private container: HTMLElement;

    constructor(containerId: string) {
        const container = document.getElementById(containerId);
        if (!container) throw new Error(`Properties panel container '${containerId}' not found.`);
        this.container = container;
    }

    /**
     * Display properties in the panel
     */
    public displayProperties(elementType: string, propertyGroups: IFCPropertyGroup[]) {
        this.clear();

        // Create header
        const header = document.createElement('div');
        header.className = 'properties-header';
        header.innerHTML = `
            <h3>${this.escapeHtml(elementType)}</h3>
            <p class="property-count">${this.getTotalPropertyCount(propertyGroups)} properties</p>
        `;
        this.container.appendChild(header);

        // Create property groups
        propertyGroups.forEach(group => {
            if (group.properties.length === 0) return;

            const groupElement = document.createElement('div');
            groupElement.className = 'property-group';

            const groupHeader = document.createElement('div');
            groupHeader.className = 'property-group-header';
            groupHeader.textContent = group.name;
            groupElement.appendChild(groupHeader);

            const propertiesList = document.createElement('div');
            propertiesList.className = 'properties-list';

            group.properties.forEach(prop => {
                const propElement = document.createElement('div');
                propElement.className = 'property-item';

                const nameElement = document.createElement('span');
                nameElement.className = 'property-name';
                nameElement.textContent = prop.name;

                const valueElement = document.createElement('span');
                valueElement.className = 'property-value';
                valueElement.textContent = this.formatValue(prop.value);

                propElement.appendChild(nameElement);
                propElement.appendChild(valueElement);
                propertiesList.appendChild(propElement);
            });

            groupElement.appendChild(propertiesList);
            this.container.appendChild(groupElement);
        });
    }

    /**
     * Clear the properties panel
     */
    public clear() {
        this.container.innerHTML = '<p class="placeholder-text">Select an element to view properties.</p>';
    }

    /**
     * Show loading state
     */
    public showLoading() {
        this.container.innerHTML = '<p class="placeholder-text">Loading properties...</p>';
    }

    /**
     * Show error message
     */
    public showError(message: string) {
        this.container.innerHTML = `<p class="error-text">${this.escapeHtml(message)}</p>`;
    }

    private getTotalPropertyCount(groups: IFCPropertyGroup[]): number {
        return groups.reduce((sum, group) => sum + group.properties.length, 0);
    }

    private formatValue(value: string | number | boolean): string {
        if (typeof value === 'boolean') {
            return value ? 'Yes' : 'No';
        }
        if (typeof value === 'number') {
            // Check if it looks like an integer or a coordinate
            if (Number.isInteger(value)) return value.toString();
            return value.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 4 });
        }
        if (typeof value === 'object' && value !== null) {
            return JSON.stringify(value);
        }
        return String(value);
    }

    private escapeHtml(text: string): string {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
}
