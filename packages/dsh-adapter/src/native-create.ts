import { assertToolArguments } from './tool-validation.js';

const failureSchema = {
  name: 'autocad_native_create_rejection', parameters: {
    type: 'object', additionalProperties: false,
    properties: {
      contract: { const: 'autocad-native-create/1' }, operation: { const: 'new_document' },
      request_id: { type: 'string', minLength: 1 }, stage: { const: 'preflight' },
      native_invoked: { const: false }, native_acknowledged: { const: false }, implicit_creates: { const: 0 },
      before_documents: { anyOf: [{type:'null'}, {type:'array',items:{type:'string'}}] },
      exception: {type:'object',additionalProperties:false,properties:{
        type:{type:'string'},message:{type:'string'},hresult:{anyOf:[{type:'null'},{type:'integer'}]},traceback:{type:'string'},
      },required:['type','message','hresult','traceback']},
    },required:['contract','operation','request_id','stage','native_invoked','native_acknowledged','implicit_creates','before_documents','exception'],
  },
};

/** Accept only the native boundary's complete, correlated evidence. Generic
 * remote error strings, mismatched requests and post-invocation failures fail closed. */
export function nativeCreateRejection(message: string, requestId: string): Record<string,unknown> | undefined {
  try {
    const evidence=JSON.parse(message) as Record<string,unknown>;
    assertToolArguments(failureSchema,evidence);
    if(evidence.request_id===requestId)return evidence;
  } catch { /* Remote prose is never a no-execution proof. */ }
  return undefined;
}
