import { randomUUID } from 'node:crypto';
import { checkoutRemoteArgs } from './checkout';
const uuid=/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;
export interface TeacherReply {dialog_id:string;task_instance_id:string;messages:{id:string;author_type:string;body:string;reply_to_message_id:string|null}[];pending:boolean}
export interface CodeCheckReply {task_instance_id:string;request_id:string;outcome:'PASS'|'FAIL'|'ERROR'|'RUNNING';advisory:true;stale:boolean;pending:boolean;issues:{code:string;message:string}[]}
export function taskCLIArgs(command:'teacher-chat'|'check-solution',origin:string,directory:string):string[]{
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
