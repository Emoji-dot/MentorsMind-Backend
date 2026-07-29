export type OTComponent = 
  | { type: 'retain'; length: number }
  | { type: 'insert'; text: string }
  | { type: 'delete'; length: number; deletedText?: string };

export interface OTOperation {
  id?: string;
  userId?: string;
  baseVersion?: number;
  components: OTComponent[];
}

export class OperationalTransform {
  static transform(op1: OTOperation, op2: OTOperation): [OTOperation, OTOperation] {
    const components1: OTComponent[] = [];
    const components2: OTComponent[] = [];

    let i = 0;
    let j = 0;
    let comp1 = op1.components[i] ? { ...op1.components[i] } : null;
    let comp2 = op2.components[j] ? { ...op2.components[j] } : null;

    while (comp1 || comp2) {
      if (comp1 && comp1.type === 'insert') {
        components1.push(comp1);
        components2.push({ type: 'retain', length: comp1.text.length });
        i++;
        comp1 = op1.components[i] ? { ...op1.components[i] } : null;
        continue;
      }
      
      if (comp2 && comp2.type === 'insert') {
        components2.push(comp2);
        components1.push({ type: 'retain', length: comp2.text.length });
        j++;
        comp2 = op2.components[j] ? { ...op2.components[j] } : null;
        continue;
      }

      if (!comp1 || !comp2) {
        break; // Or throw Error('Mismatched lengths');
      }

      if (comp1.type === 'retain' && comp2.type === 'retain') {
        const minLen = Math.min(comp1.length, comp2.length);
        components1.push({ type: 'retain', length: minLen });
        components2.push({ type: 'retain', length: minLen });
        
        comp1.length -= minLen;
        if (comp1.length === 0) {
          i++;
          comp1 = op1.components[i] ? { ...op1.components[i] } : null;
        }
        
        comp2.length -= minLen;
        if (comp2.length === 0) {
          j++;
          comp2 = op2.components[j] ? { ...op2.components[j] } : null;
        }
      } else if (comp1.type === 'delete' && comp2.type === 'delete') {
        const minLen = Math.min(comp1.length, comp2.length);
        
        comp1.length -= minLen;
        if (comp1.length === 0) {
          i++;
          comp1 = op1.components[i] ? { ...op1.components[i] } : null;
        }
        
        comp2.length -= minLen;
        if (comp2.length === 0) {
          j++;
          comp2 = op2.components[j] ? { ...op2.components[j] } : null;
        }
      } else if (comp1.type === 'delete' && comp2.type === 'retain') {
        const minLen = Math.min(comp1.length, comp2.length);
        components1.push({ type: 'delete', length: minLen });
        
        comp1.length -= minLen;
        if (comp1.length === 0) {
          i++;
          comp1 = op1.components[i] ? { ...op1.components[i] } : null;
        }
        
        comp2.length -= minLen;
        if (comp2.length === 0) {
          j++;
          comp2 = op2.components[j] ? { ...op2.components[j] } : null;
        }
      } else if (comp1.type === 'retain' && comp2.type === 'delete') {
        const minLen = Math.min(comp1.length, comp2.length);
        components2.push({ type: 'delete', length: minLen });
        
        comp1.length -= minLen;
        if (comp1.length === 0) {
          i++;
          comp1 = op1.components[i] ? { ...op1.components[i] } : null;
        }
        
        comp2.length -= minLen;
        if (comp2.length === 0) {
          j++;
          comp2 = op2.components[j] ? { ...op2.components[j] } : null;
        }
      }
    }

    return [
      { ...op1, components: components1 },
      { ...op2, components: components2 }
    ];
  }

  static applyAndExtractDeleted(doc: string, op: OTOperation): { newDoc: string; enrichedOp: OTOperation } {
    let result = '';
    let cursor = 0;
    const enrichedComponents: OTComponent[] = [];

    for (const comp of op.components) {
      if (comp.type === 'retain') {
        result += doc.slice(cursor, cursor + comp.length);
        cursor += comp.length;
        enrichedComponents.push({ ...comp });
      } else if (comp.type === 'insert') {
        result += comp.text;
        enrichedComponents.push({ ...comp });
      } else if (comp.type === 'delete') {
        const deletedText = doc.slice(cursor, cursor + comp.length);
        cursor += comp.length;
        enrichedComponents.push({ ...comp, deletedText });
      }
    }

    result += doc.slice(cursor);
    return { newDoc: result, enrichedOp: { ...op, components: enrichedComponents } };
  }

  static apply(doc: string, op: OTOperation): string {
    return this.applyAndExtractDeleted(doc, op).newDoc;
  }

  static invert(op: OTOperation): OTOperation {
    const invertedComponents: OTComponent[] = op.components.map(comp => {
      if (comp.type === 'insert') {
        return { type: 'delete', length: comp.text.length, deletedText: comp.text };
      } else if (comp.type === 'delete') {
        return { type: 'insert', text: comp.deletedText ?? '' };
      }
      return comp;
    });
    return { ...op, components: invertedComponents };
  }
}
