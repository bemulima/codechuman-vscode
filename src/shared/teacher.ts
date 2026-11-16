import { randomUUID } from 'node:crypto';
import { checkoutRemoteArgs } from './checkout';
const uuid=/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;
export interface TeacherReply {dialog_id:string;task_instance_id:string;messages:{id:string;author_type:string;body:string;reply_to_message_id:string|null}[];pending:boolean}
export interface CodeCheckReply {task_instance_id:string;request_id:string;outcome:'PASS'|'FAIL'|'ERROR'|'RUNNING';advisory:true;stale:boolean;pending:boolean;issues:{code:string;message:string}[]}
export function taskCLIArgs(command:'teacher-chat'|'check-solution'|'submit-solution',origin:string,directory:string):string[]{
 const normalized=checkoutRemoteArgs(origin,'22222222-2222-4222-8222-222222222222',directory)[2];
 return [command,'--api-base',normalized,'--workspace',directory,'--request-stdin'];
}
export function teacherInput(token:string,body:string):string{
 if(!body.trim()||Buffer.byteLength(body,'utf8')>12000)throw new Error('Введите вопрос до 12 КБ.');
 return JSON.stringify({token,body,idempotency_key:randomUUID(),sync_main:true});
}
export function parseTeacherReply(value:unknown,task:string):TeacherReply{
 const v=value as TeacherReply;
 if(!v||v.task_instance_id!==task||!uuid.test(v.dialog_id)||typeof v.pending!=='boolean'||!Array.isArray(v.messages)||v.messages.length>200)throw new Error('Некорректный ответ Teacher.');
 for(const m of v.messages)if(!m||!uuid.test(m.id)||!['personal_teacher','student','user'].includes(m.author_type)||typeof m.body!=='string'||Buffer.byteLength(m.body,'utf8')>24000||(m.reply_to_message_id!==null&&!uuid.test(m.reply_to_message_id)))throw new Error('Некорректное сообщение Teacher.');
 return {dialog_id:v.dialog_id,task_instance_id:v.task_instance_id,pending:v.pending,messages:v.messages.map(m=>({id:m.id,author_type:m.author_type,body:m.body,reply_to_message_id:m.reply_to_message_id}))};
}
export function parseCodeCheck(value:unknown,task:string):CodeCheckReply{
 const v=value as CodeCheckReply;
 if(!v||v.task_instance_id!==task||!uuid.test(v.request_id)||v.advisory!==true||!['PASS','FAIL','ERROR','RUNNING'].includes(v.outcome)||typeof v.stale!=='boolean'||typeof v.pending!=='boolean'||!Array.isArray(v.issues)||v.issues.length>7)throw new Error('Некорректная квитанция Sandbox.');
 for(const i of v.issues)if(!i||typeof i.code!=='string'||!/^[A-Z][A-Z0-9_]{0,127}$/.test(i.code)||typeof i.message!=='string'||i.message.length>512)throw new Error('Некорректная ошибка Sandbox.');
 if(v.outcome==='PASS'&&v.issues.length)throw new Error('Противоречивый результат Sandbox.');
 return {task_instance_id:v.task_instance_id,request_id:v.request_id,outcome:v.outcome,advisory:true,stale:v.stale,pending:v.pending,issues:v.issues.map(i=>({code:i.code,message:i.message}))};
}

export interface SubmitReply {task_instance_id:string;idempotency_key:string;scope:'MILESTONE'|'FINAL';milestone_id?:string;uncertain:boolean;submission?:{schema:string;id:string;task_instance_id:string;student_id:string;scope:string;milestone_id?:string;workspace_digest:string;status:string}}
export function parseSubmitReply(value:unknown,task:string,key:string):SubmitReply{
 const v=value as SubmitReply;
 if(!v||v.task_instance_id!==task||v.idempotency_key!==key||!uuid.test(key)||!['MILESTONE','FINAL'].includes(v.scope)||typeof v.uncertain!=='boolean'||(v.scope==='MILESTONE'&&!uuid.test(v.milestone_id??'')))throw new Error('Некорректная официальная квитанция; сохраните исходный ключ.');
 const out:SubmitReply={task_instance_id:task,idempotency_key:key,scope:v.scope,milestone_id:v.milestone_id,uncertain:v.uncertain};
 if(v.submission){const s=v.submission;if(v.uncertain||s.schema!=='practice-task-submission.v2'||!uuid.test(s.id)||!uuid.test(s.student_id)||s.task_instance_id!==task||s.scope!==v.scope||s.milestone_id!==v.milestone_id||!/^sha256:[0-9a-f]{64}$/.test(s.workspace_digest)||!/^[A-Z][A-Z_]{0,31}$/.test(s.status))throw new Error('Неподтверждённая официальная квитанция.');out.submission={schema:s.schema,id:s.id,student_id:s.student_id,task_instance_id:s.task_instance_id,scope:s.scope,milestone_id:s.milestone_id,workspace_digest:s.workspace_digest,status:s.status};}
 else if(!v.uncertain)throw new Error('Отсутствует официальная квитанция.');return out;
}

// A process failure is not a durable upload/Submit receipt. Keep its original
// key, but never turn an unknown first attempt into a replay against old code.
export class OfficialSubmitRecovery {
 private readonly pending=new Map<string,{origin:string;task:string;result:SubmitReply;confirmed:boolean}>();
 plan(directory:string,task:string,origin:string,scope:'MILESTONE'|'FINAL',key:string):{scope:'MILESTONE'|'FINAL';idempotency_key:string;milestone_id?:string;replay:boolean}{
  const normalized=new URL(origin).origin,previous=this.pending.get(directory);
  if(previous&&(previous.origin!==normalized||previous.task!==task||!previous.confirmed))throw new Error('Предыдущая отправка не подтверждена для этого задания и Gateway. Проверьте официальную историю; исходный ключ сохранён.');
  const result=previous?.result??{task_instance_id:task,idempotency_key:key,scope,uncertain:true};
  if(!previous)this.pending.set(directory,{origin:normalized,task,result,confirmed:false});
  return {scope:result.scope,idempotency_key:result.idempotency_key,milestone_id:result.milestone_id,replay:!!previous};
 }
 accept(directory:string,task:string,origin:string,key:string,value:unknown):SubmitReply{
  const previous=this.pending.get(directory);
  if(!previous||previous.task!==task||previous.origin!==new URL(origin).origin||previous.result.idempotency_key!==key)throw new Error('Контекст официальной отправки изменился.');
  const result=parseSubmitReply(value,task,key);
  if(result.uncertain||result.submission?.status==='VALIDATING')this.pending.set(directory,{...previous,result,confirmed:true});else this.pending.delete(directory);
  return result;
 }
}
