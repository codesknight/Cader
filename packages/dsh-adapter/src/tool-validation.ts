import { Ajv } from 'ajv';
import { Ajv2020 } from 'ajv/dist/2020.js';
import { Ajv2019 } from 'ajv/dist/2019.js';
import type { ValidateFunction } from 'ajv';
import type { ToolDefinition } from '@deepseek-ai/dsh-tools';
const options={
  allErrors: true,strict: true,strictRequired: false,
  coerceTypes: false,useDefaults: false,removeAdditional: false,addUsedSchema: false
};
const validators={ legacy: new Ajv(options),modern: new Ajv2020(options),transitional: new Ajv2019(options) };
const cache=new WeakMap<object,ValidateFunction>();
/** Only this local validator can prove that the MCP invocation was never sent.
 * A remote error message (including one containing "validation") is not such proof. */
export class ToolArgumentsError extends Error {
  readonly code='TOOL_ARGUMENTS_INVALID';
  readonly dispatched=false;
  constructor(readonly tool: string,readonly issues: {
    path: string;
    keyword: string;
    message: string;
  }[]) {
    super(JSON.stringify({
      code: 'TOOL_ARGUMENTS_INVALID',tool,stage: 'preflight',
      outcome: 'failed_before_dispatch',dispatched: false,issues
    }));
    this.name='ToolArgumentsError';
  }
}
export function assertToolArguments(tool: Pick<ToolDefinition,'name'|'parameters'>,args: unknown): void {
  const schema=tool.parameters as Record<string,unknown>;
  let validate=cache.get(schema);
  if(!validate) {
    try {
      const dialect=String(schema.$schema??'').replace(/#$/,'');
      if(schema.$async)
        throw new Error('Async schema is unsupported');
      if(dialect&&!/^https?:\/\/json-schema\.org\/(?:draft-07|draft\/(?:2020-12|2019-09))\/schema$/.test(dialect))
        throw new Error('Unsupported dialect');
      const compiler=String(dialect).includes('2020-12')? validators.modern
        :String(dialect).includes('2019-09')? validators.transitional:validators.legacy;
      const canonical=dialect.includes('2020-12')? 'https://json-schema.org/draft/2020-12/schema':dialect.includes('2019-09')? 'https://json-schema.org/draft/2019-09/schema':'http://json-schema.org/draft-07/schema#';
      validate=compiler.compile(dialect? { ...schema,$schema: canonical }:schema);
      cache.set(schema,validate);
    }
    catch {
      throw new ToolArgumentsError(tool.name,[{ path: '/',keyword: 'schema',message: 'Unsupported or invalid input schema; invocation refused' }]);
    }
  }
  if(!validate(args))
    throw new ToolArgumentsError(tool.name,(validate.errors??[]).slice(0,12).map(issue => ({
      path: issue.instancePath+(issue.keyword==='required'? '/'+String(issue.params.missingProperty):''),
      keyword: issue.keyword,message: issue.message??'Invalid argument'
    })));
}
/** Keep local references anchored to their original schema when embedded in a patch. */
export function patchArgumentsSchema(tool: ToolDefinition,prefix: string): Record<string,unknown> {
  const walk=(value: unknown): unknown => {
    if(Array.isArray(value))
      return value.map(walk);
    if(!value||typeof value!=='object')
      return value;
    return Object.fromEntries(Object.entries(value).filter(([key]) => !['$schema','$id'].includes(key)).map(([key,child]) => {
      if(['default','const','enum','examples'].includes(key))
        return [key,child];
      if(['properties','$defs','definitions','patternProperties','dependentSchemas'].includes(key)&&child&&typeof child==='object')
        return [key,Object.fromEntries(Object.entries(child).map(([name,schema]) => [name,walk(schema)]))];
      return [key,key==='$ref'&&typeof child==='string'&&child.startsWith('#')? prefix+child.slice(1):walk(child)];
    }));
  };
  return walk(tool.parameters) as Record<string,unknown>;
}
