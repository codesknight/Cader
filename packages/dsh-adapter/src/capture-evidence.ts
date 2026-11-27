import { isDeepStrictEqual } from 'node:util';
import { assertToolArguments } from './tool-validation.js';

const scalar={anyOf:[{type:'string'},{type:'number'},{type:'boolean'},{type:'null'}]};
const pair={type:'array',minItems:2,maxItems:2,items:{type:'number'}};
const layout={type:'object',additionalProperties:false,properties:{
  ...Object.fromEntries(['ConfigName','CanonicalMediaName','PlotType','PlotRotation','UseStandardScale','StandardScale','CenterPlot','PaperUnits'].map(key=>[key,scalar])),
  PlotOrigin:pair,window:{type:'array',minItems:2,maxItems:2,items:pair},custom_scale:pair,
},required:['ConfigName','CanonicalMediaName','PlotType','PlotRotation','UseStandardScale','StandardScale','CenterPlot','PaperUnits','PlotOrigin','window','custom_scale']};
const state={type:'object',additionalProperties:false,properties:{layout,background:{type:'number'},quiet:{type:'boolean'},configurations:{type:'array',uniqueItems:true,items:{type:'string'}}},required:['layout','background','quiet','configurations']};
const nullable=(value:unknown)=>({anyOf:[{type:'null'},value]});
const windowBox={type:'array',minItems:4,maxItems:4,items:{type:'number'}};
const schema={name:'native_capture_receipt',parameters:{type:'object',additionalProperties:false,properties:{
  contract:{const:'autocad-capture/1'},request_id:{type:'string',minLength:1},file_path:{type:'string',minLength:1},
  document:nullable({type:'string'}),layout:nullable({type:'string'}),
  stage:{enum:['preflight','backup','configure','plot','artifact','complete']},
  requested_view:{type:'object',additionalProperties:false,properties:{world_window:nullable(windowBox),min_long_edge:{type:'integer',minimum:0,maximum:4096}},required:['world_window','min_long_edge']},
  view_evidence:nullable({type:'object',additionalProperties:false,properties:{world_window:nullable(windowBox),dcs_window:nullable({type:'array',minItems:2,maxItems:2,items:pair}),canonical_media:nullable({type:'string'}),configuration_verified:{type:'boolean'},expected_pixels:nullable({type:'array',minItems:2,maxItems:2,items:{type:'integer',minimum:1,maximum:4096}}),projection:{enum:['WCS_XY_TOP','backend_extents']},pixel_to_world:{type:'null'},mapping_mode:{const:'window_and_fit; exact pixel mapping unsupported'}},required:['world_window','dcs_window','canonical_media','configuration_verified','expected_pixels','projection','pixel_to_world','mapping_mode']}),
  capture_mutations_started:{type:'boolean'},mutation_uncertain:{type:'boolean'},restoration_verified:{type:'boolean'},cleanup_verified:{type:'boolean'},
  before:nullable(state),after:nullable(state),backup_name:{type:'string',pattern:'^_MCP_CAPTURE_[a-f0-9]{32}$'},
  actions:{type:'array',items:{type:'object',additionalProperties:false,properties:{name:{enum:['backup_add','backup_copy','foreground','quiet','device','refresh_device','media','rotation','window','plot_type','standard_scale','fit','center','plot_to_file','restore_layout','restore_background','restore_quiet','delete_backup']},acknowledged:{type:'boolean'}},required:['name','acknowledged']}},
  restoration_errors:{type:'array',items:{type:'object',properties:{action:{type:'string'},error:{type:'string'}},required:['action','error'],additionalProperties:false}},
  error:nullable({type:'object',properties:{type:{type:'string'},message:{type:'string'},hresult:nullable({type:'integer'}),traceback:{type:'string'}},required:['type','message','hresult','traceback'],additionalProperties:false}),
},required:['contract','request_id','file_path','document','layout','stage','capture_mutations_started','mutation_uncertain','restoration_verified','cleanup_verified','before','after','backup_name','actions','restoration_errors','error']}};

export interface CaptureReceipt {
  contract:string; request_id:string; file_path:string; document:string|null;layout:string|null;stage:string;
  capture_mutations_started:boolean;mutation_uncertain:boolean;restoration_verified:boolean;cleanup_verified:boolean;
  before:Record<string,unknown>|null;after:Record<string,unknown>|null;backup_name:string;
  actions:{name:string;acknowledged:boolean}[];restoration_errors:{action:string;error:string}[];error:unknown;
  requested_view?:{world_window:number[]|null;min_long_edge:number};view_evidence?:{world_window:number[]|null;expected_pixels:number[]|null;projection:string;[key:string]:unknown}|null;
}
/** A receipt is current-request evidence, never permission to clear a historic lock. */
export function captureEvidence(value:unknown,requestId:string,path:string,document?:string):CaptureReceipt|undefined{
  try{
    assertToolArguments(schema,value);
    const receipt=value as CaptureReceipt;
    if(receipt.request_id!==requestId||receipt.file_path!==path)return;
    if(receipt.mutation_uncertain||receipt.restoration_errors.length||receipt.actions.some(a=>!a.acknowledged))return;
    const actions=receipt.actions.map(a=>a.name);
    if(new Set(actions).size!==actions.length)return;
    if(receipt.capture_mutations_started&&(!actions.includes('backup_add')||!actions.includes('delete_backup')))return;
    const settings=actions.some(name=>['foreground','quiet','device','refresh_device','media','rotation','window','plot_type','standard_scale','fit','center','plot_to_file'].includes(name));
    if(settings&&['backup_copy','restore_layout','restore_background','restore_quiet'].some(name=>!actions.includes(name)))return;
    if(receipt.stage==='complete'&&!actions.includes('plot_to_file'))return;
    const preflight=receipt.stage==='preflight'&&!receipt.capture_mutations_started&&!receipt.actions.length;
    if(document!==undefined&&receipt.document!==document&&!(preflight&&receipt.document===null))return;
    const restored=receipt.capture_mutations_started&&receipt.actions.length>0&&receipt.restoration_verified&&receipt.cleanup_verified&&
      receipt.before!==null&&isDeepStrictEqual(receipt.before,receipt.after)&&
      !(receipt.after!.configurations as string[]).includes(receipt.backup_name);
    if(preflight||restored)return receipt;
  }catch{/* Prose, partial receipts and mismatched requests remain uncertain. */}
  return undefined;
}
