import json,pathlib
root=pathlib.Path(__file__).resolve().parents[1]
obj=lambda props,required=None:{'type':'object','additionalProperties':False,'properties':props,'required':required if required is not None else list(props)}
string=lambda **kw:{'type':'string',**kw}
uuid=string(format='uuid');boolean={'type':'boolean'};integer=lambda a,b:{'type':'integer','minimum':a,'maximum':b};array=lambda x,n=50:{'type':'array','items':x,'maxItems':n};enum=lambda *x:string(enum=list(x))
ref=lambda n:{'$ref':'#/components/schemas/'+n}
schemas={
 'Problem':obj({'error':obj({'code':string(),'message':string(),'trace_id':string()})}),
 'Session':obj({'access_token':string(),'refresh_token':string(),'expires_in':integer(1,3600),'user_id':uuid}),
 'Challenge':obj({'challenge_id':uuid,'expires_in':integer(1,600),'local_code':string(description='Only in explicit LOCAL_MODE; never returned by production.')},['challenge_id','expires_in']),
 'Photo':obj({'id':uuid,'position':integer(0,8),'status':enum('pending','approved','rejected')},['id']),
 'Person':obj({'id':uuid,'display_name':string(),'age':integer(18,120),'bio':string(),'gender':string(),'relationship_intent':string(),'interests':array(string(),20),'languages':array(string(),10),'photos':array(ref('Photo'),9),'adult_eligibility_verified':boolean,'compatibility':obj({'score':integer(0,100),'highlights':array(string()),'version':string()})},['id','display_name','age','bio','gender','relationship_intent','interests','languages','photos']),
 'Match':obj({'id':uuid,'user_a':uuid,'user_b':uuid,'status':enum('active','unmatched','blocked'),'display_name':string()},['id','user_a','user_b']),
 'Message':obj({'id':uuid,'sender_id':uuid,'body':string(maxLength=2000),'reply_to':{'type':['string','null']},'created_at':integer(0,9999999999),'sequence':integer(1,9999999999)}),
 'ProfileInput':obj({'display_name':string(minLength=1,maxLength=50),'date_of_birth':string(format='date'),'bio':string(maxLength=500),'gender':string(minLength=1,maxLength=40),'relationship_intent':enum('serious','long_term','exploring','casual','shared_interests'),'interests':array(string(maxLength=40),20),'languages':array(string(maxLength=40),10),'lifestyle':{'type':'object','additionalProperties':string(maxLength=40)},'date_readiness':enum('chat_first','video_call','meet_after_chat'),'location':obj({'latitude':{'type':'number','minimum':-90,'maximum':90},'longitude':{'type':'number','minimum':-180,'maximum':180},'city':string(minLength=1,maxLength=80)}),'complete':boolean},['display_name','date_of_birth','bio','gender','relationship_intent','interests','languages','location']),
 'Preferences':obj({'min_age':integer(18,99),'max_age':integer(18,120),'genders':array(string(),10),'radius_km':integer(1,500),'intentions':array(string(),5)}),
 'Privacy':obj({x:boolean for x in ['show_distance','show_activity','read_receipts','incognito','paused']}),
 'NotificationPreferences':obj({x:boolean for x in ['matches','messages','safety','previews']}),
 'Report':obj({'target_id':uuid,'category':enum('fake_profile','spam','scam','harassment','threats','underage','nonconsensual_imagery','impersonation','other'),'details':string(minLength=1,maxLength=3000),'conversation_id':uuid},['target_id','category','details']),
 'Swipe':obj({'target_id':uuid,'action':enum('like','pass','super_like')}),
 'Entitlement':obj({'tier':enum('free','plus','gold','elite'),'expires_at':{'type':['integer','null']}})
}
paths={}
def endpoint(method,path,body=None,response=None,public=False,status=200,desc='',tag=None):
 p={ 'operationId':method+'_'+path.replace('/v1/','').replace('/','_').replace('{','').replace('}','').replace('-','_'),'tags':[tag or path.split('/')[2]],'summary':desc or path.replace('/v1/','').replace('/',' · '),'security':[] if public else [{'BearerAuth':[]}], 'responses':{} }
 parameters=[]
 for part in path.split('/'):
  if part.startswith('{'):parameters.append({'name':part[1:-1],'in':'path','required':True,'schema':uuid})
 if method=='get' and path in ['/v1/discover','/v1/matches','/v1/conversations','/v1/likes/received','/v1/admin/cases','/v1/admin/users']:
  parameters.extend([{'name':'limit','in':'query','schema':integer(1,50)},{'name':'cursor','in':'query','schema':string()}])
 if path=='/v1/swipes':parameters.append({'name':'Idempotency-Key','in':'header','required':True,'schema':string(minLength=1,maxLength=128)})
 if path=='/v1/realtime/connect':parameters.append({'name':'conversation_id','in':'query','required':True,'schema':uuid})
 if path.endswith('/messages') and method=='get':parameters.extend([{'name':'after','in':'query','schema':integer(0,9999999999)},{'name':'q','in':'query','schema':string(maxLength=100)},{'name':'limit','in':'query','schema':integer(1,50)}])
 if parameters:p['parameters']=parameters
 if body is not None:p['requestBody']={'required':True,'content':{'application/json':{'schema':body}}}
 response=response or {'type':'object','additionalProperties':True}
 p['responses'][str(status)]={'description':'Successful operation','content':{'application/json':{'schema':obj({'data':response,'next_cursor':{'type':['string','integer','null']}},['data'])}}}
 for s in [400,401,403,404,409,413,429,503]:p['responses'][str(s)]={'description':{400:'Invalid input',401:'Authentication required',403:'Not authorized or eligible',404:'Resource unavailable',409:'State conflict',413:'Body exceeds size limit',429:'Rate limit or quota exhausted',503:'Required provider not configured'}[s],'content':{'application/json':{'schema':ref('Problem')}}}
 paths.setdefault(path,{})[method]=p
for provider in ['email','phone']:
 endpoint('post',f'/v1/auth/{provider}/start',obj({'destination':string(format='email') if provider=='email' else string(pattern=r'^\+[1-9]\d{7,14}$')}),ref('Challenge'),True,202)
 verification=obj({'challenge_id':uuid,'code':string(pattern=r'^\d{6}$')})
 endpoint('post',f'/v1/auth/{provider}/verify',verification,ref('Session'),True)
 endpoint('post',f'/v1/auth/link/{provider}',verification)
endpoint('post','/v1/auth/apple',obj({'identity_token':string(minLength=20,maxLength=10000),'nonce':string(minLength=32,maxLength=128)}),ref('Session'),True)
endpoint('post','/v1/auth/refresh',obj({'refresh_token':string(pattern='^[a-f0-9]{64}$')}),ref('Session'),True)
for path in ['logout','logout-all']:endpoint('post','/v1/auth/'+path,obj({}))
endpoint('get','/v1/me');endpoint('patch','/v1/me',ref('ProfileInput'));endpoint('delete','/v1/me');endpoint('post','/v1/me/age-assurance',obj({'attestation':string(minLength=20,maxLength=12000)}));endpoint('post','/v1/me/data-export',obj({}))
endpoint('patch','/v1/passport',obj({'city':{'type':['string','null']},'latitude':{'type':['number','null']},'longitude':{'type':['number','null']}}));endpoint('patch','/v1/preferences',ref('Preferences'));endpoint('get','/v1/profiles/{profileId}',response=ref('Person'))
endpoint('get','/v1/me/photos',response=array(ref('Photo'),9));endpoint('post','/v1/me/photos/upload-intent',obj({}),status=201);endpoint('post','/v1/me/photos/complete',obj({'photo_id':uuid}),status=202);endpoint('delete','/v1/me/photos/{photoId}');endpoint('patch','/v1/me/photos/order',obj({'photo_ids':array(uuid,9)}))
endpoint('put','/v1/me/photos/{photoId}/content');upload=paths['/v1/me/photos/{photoId}/content']['put'];upload['parameters'].append({'name':'X-Upload-Token','in':'header','required':True,'schema':string()});upload['requestBody']={'required':True,'content':{'application/octet-stream':{'schema':string(format='binary',maxLength=10485760)}}}
endpoint('get','/v1/photos/{photoId}');paths['/v1/photos/{photoId}']['get']['responses']['200']={'description':'Authorized photo bytes','content':{'image/jpeg':{'schema':string(format='binary')},'image/png':{'schema':string(format='binary')}}}
endpoint('get','/v1/discover',response=array(ref('Person')));endpoint('get','/v1/explore');endpoint('get','/v1/likes/received',response=array(ref('Person')));endpoint('post','/v1/swipes',ref('Swipe'));endpoint('post','/v1/swipes/rewind',obj({}))
for path in ['/v1/matches','/v1/matches/{matchId}']:endpoint('get',path,response=array(ref('Match')) if path.endswith('matches') else ref('Match'))
endpoint('delete','/v1/matches/{matchId}');endpoint('get','/v1/conversations');endpoint('get','/v1/conversations/{conversationId}/messages',response=array(ref('Message')));endpoint('post','/v1/conversations/{conversationId}/messages',obj({'client_id':uuid,'body':string(minLength=1,maxLength=2000),'reply_to':{'type':['string','null'],'format':'uuid'}},['client_id','body']),ref('Message'))
endpoint('post','/v1/conversations/{conversationId}/receipts',obj({'message_id':uuid,'read':boolean}));endpoint('post','/v1/conversations/{conversationId}/reactions',obj({'message_id':uuid,'emoji':enum('❤️','👍','😂','✨','😊')}));endpoint('patch','/v1/conversations/{conversationId}/settings',obj({'muted':boolean,'hidden':boolean}));endpoint('get','/v1/realtime/connect',desc='WebSocket upgrade; bearer header required. Send text through REST; receive message and typing events.')
endpoint('get','/v1/entitlements',response=ref('Entitlement'));endpoint('get','/v1/products');endpoint('post','/v1/purchases/sync',obj({'signed_transaction':string(minLength=20,maxLength=20000)}));endpoint('post','/v1/webhooks/apple',obj({'signedPayload':string(minLength=20,maxLength=20000)}),public=True);endpoint('post','/v1/consumables/redeem',obj({'kind':enum('boost'),'idempotency_key':uuid}))
endpoint('post','/v1/users/{userId}/block',obj({}));endpoint('post','/v1/reports',ref('Report'),status=201);endpoint('post','/v1/appeals',obj({'details':string(minLength=1,maxLength=3000)}),status=201);endpoint('get','/v1/privacy');endpoint('patch','/v1/privacy',ref('Privacy'));endpoint('patch','/v1/notifications',ref('NotificationPreferences'));endpoint('post','/v1/devices',obj({'token':string(pattern='^[a-f0-9]{64,200}$'),'environment':enum('sandbox','production')}))
for path in ['overview','users','cases','cases/{caseId}/evidence','photos','audit','flags','finance','health']:endpoint('get','/v1/admin/'+path,tag='Admin');paths['/v1/admin/'+path]['get']['security']=[{'CloudflareAccess':[]}]
endpoint('patch','/v1/admin/cases/{caseId}',obj({'status':enum('reviewing','resolved'),'resolution':string(minLength=1,maxLength=1000),'ban_user':boolean},['status','resolution']),tag='Admin');endpoint('patch','/v1/admin/flags/{name}',obj({'enabled':boolean}),tag='Admin')
endpoint('get','/v1/admin/photos/{photoId}/content',tag='Admin');endpoint('patch','/v1/admin/photos/{photoId}',obj({'status':enum('approved','rejected')}),tag='Admin')
for path in ['/v1/admin/photos/{photoId}', '/v1/admin/cases/{caseId}','/v1/admin/flags/{name}']:paths[path]['patch']['security']=[{'CloudflareAccess':[]}]
paths['/v1/admin/flags/{name}']['patch']['parameters'][0]['schema']=string()
contract={'openapi':'3.1.0','info':{'title':'HeartTrail API','version':'0.1.0','description':'Adults-only dating API. Local mock adapters are never production verification. See docs/release/readiness.md for release gates.'},'servers':[{'url':'http://127.0.0.1:8787','description':'Local development'},{'url':'https://api.example.invalid','description':'Configure production domain before use'}],'paths':paths,'components':{'securitySchemes':{'BearerAuth':{'type':'http','scheme':'bearer','bearerFormat':'opaque short-lived token'},'CloudflareAccess':{'type':'apiKey','in':'header','name':'Cf-Access-Jwt-Assertion'}},'schemas':schemas}}
(root/'packages/api-contract/openapi.json').write_text(json.dumps(contract,indent=2)+'\n')
