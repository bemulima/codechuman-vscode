import {describe,it,expect} from 'vitest';
import {taskCLIArgs,teacherInput,parseTeacherReply,parseCodeCheck,parseSubmitReply} from '../shared/teacher';
import {isClientRequest} from '../shared/protocol';
const task='22222222-2222-4222-8222-222222222222',id='11111111-1111-4111-8111-111111111111';
describe('Teacher and Sandbox CLI boundary',()=>{
 it('uses separate stdin credentials and approved commands only',()=>{
  expect(taskCLIArgs('teacher-chat','https://example.org','/task')).toEqual(['teacher-chat','--api-base','https://example.org','--workspace','/task','--request-stdin']);
  expect(()=>taskCLIArgs('check-solution','http://example.org','/task')).toThrow();
  const data=JSON.parse(teacherInput('synthetic-token','Explain my code'));expect(data.token).toBe('synthetic-token');expect(data.sync_main).toBe(true);expect(data.idempotency_key).toMatch(/^[0-9a-f-]{36}$/);
  expect(()=>teacherInput('t','')).toThrow();expect(()=>teacherInput('t','ю'.repeat(7000))).toThrow();
 });
 it('rejects cross-task/malformed replies and strips extra secret fields',()=>{
  const v={task_instance_id:task,dialog_id:id,messages:[{id,author_type:'personal_teacher',body:'Hint',reply_to_message_id:null,token:'secret'}],pending:false,token:'secret'};
  expect(JSON.stringify(parseTeacherReply(v,task))).not.toContain('secret');
  expect(()=>parseTeacherReply(v,id)).toThrow();expect(()=>parseTeacherReply({...v,messages:[{...v.messages[0],author_type:'admin'}]},task)).toThrow();
 });
 it('keeps technical errors and stale verdicts distinct from semantic PASS',()=>{
  for(const outcome of ['PASS','FAIL','ERROR','RUNNING']){
   const v={task_instance_id:task,request_id:id,outcome,advisory:true,stale:true,pending:outcome==='RUNNING',issues:[],token:'secret'};
   expect(parseCodeCheck(v,task).outcome).toBe(outcome);expect(JSON.stringify(parseCodeCheck(v,task))).not.toContain('secret');
   expect(()=>parseCodeCheck({...v,advisory:false},task)).toThrow();
  }
  expect(()=>parseCodeCheck({task_instance_id:task,request_id:id,outcome:'PASS',advisory:true,stale:false,pending:false,issues:[{code:'BAD',message:'failed'}]},task)).toThrow();
 });
 it('allows only explicit bounded Teacher/check UI actions',()=>{
  expect(isClientRequest({type:'teacher-send',directory:'/task',body:'help'})).toBe(true);
  expect(isClientRequest({type:'teacher-send',directory:'/task',body:''})).toBe(false);
  expect(isClientRequest({type:'teacher-send',directory:'/task',body:4})).toBe(false);
  expect(isClientRequest({type:'teacher-refresh',directory:'/task'})).toBe(true);
  expect(isClientRequest({type:'sandbox-check',directory:'/task'})).toBe(true);
 });
});

describe('official Submit is a separate server authority',()=>{
 it('preserves an unconfirmed key instead of inventing success',()=>{const value={task_instance_id:task,idempotency_key:id,scope:'MILESTONE',milestone_id:id,uncertain:true,token:'secret'};expect(parseSubmitReply(value,task,id).uncertain).toBe(true);expect(JSON.stringify(parseSubmitReply(value,task,id))).not.toContain('secret');expect(()=>parseSubmitReply({...value,uncertain:false},task,id)).toThrow();expect(isClientRequest({type:'official-submit',directory:'/task',scope:'MILESTONE'})).toBe(true);expect(isClientRequest({type:'official-submit',directory:'/task',scope:'FREE_PASS'})).toBe(false);});
});
