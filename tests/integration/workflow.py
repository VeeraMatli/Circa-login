"""Exercise the real Worker, local D1/R2/Queues/Durable Objects. No mocked HTTP API."""
import atexit, concurrent.futures, json, os, pathlib, socket, subprocess, tempfile, time, unittest, urllib.request, urllib.error, uuid
ROOT=pathlib.Path(__file__).resolve().parents[2]
API=ROOT/'services/api'
STATE=tempfile.TemporaryDirectory(prefix='anvaya-integration-')
PORT=8791
BASE=f'http://127.0.0.1:{PORT}'
process=None
log=None
def call(method,path,data=None,token=None,headers=None):
    h={'Content-Type':'application/json',**(headers or {})}
    if token:h['Authorization']='Bearer '+token
    payload=json.dumps(data).encode() if data is not None else None
    req=urllib.request.Request(BASE+path,data=payload,method=method,headers=h)
    try:
        with urllib.request.urlopen(req,timeout=20) as res:return res.status,json.loads(res.read())
    except urllib.error.HTTPError as e:
        return e.code,json.loads(e.read())
def cleanup():
    if process and process.poll() is None:
        import signal
        os.killpg(process.pid,signal.SIGTERM)
        try:process.wait(timeout=10)
        except subprocess.TimeoutExpired:os.killpg(process.pid,signal.SIGKILL)
    if log:log.close()
    STATE.cleanup()
atexit.register(cleanup)
class Workflow(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        global process,log
        runtime={**os.environ,'XDG_CONFIG_HOME':'/tmp/anvaya-config','WRANGLER_LOG_PATH':'/tmp/anvaya-integration-wrangler.log','WRANGLER_SEND_METRICS':'false'}
        cli=str(ROOT/'node_modules/.bin/wrangler')
        subprocess.run([cli,'d1','migrations','apply','anvaya-local','--local','--persist-to',STATE.name],cwd=API,env=runtime,check=True,stdout=subprocess.DEVNULL)
        log=open('/tmp/anvaya-integration.log','w+')
        process=subprocess.Popen([cli,'dev','--local','--ip','127.0.0.1','--port',str(PORT),'--persist-to',STATE.name],cwd=API,env=runtime,stdout=log,stderr=subprocess.STDOUT,start_new_session=True)
        for _ in range(100):
            try:
                status,_=call('GET','/health')
                if status==200:break
            except (OSError,urllib.error.URLError):pass
            if process.poll() is not None:raise RuntimeError(pathlib.Path(log.name).read_text())
            time.sleep(.2)
        else:raise RuntimeError('Worker failed readiness: '+pathlib.Path(log.name).read_text())
        cls.accounts=[]
        for i in range(6):
            destination=f'test-{uuid.uuid4()}@example.invalid'
            status,challenge=call('POST','/v1/auth/email/start',{'destination':destination})
            assert status==202,(status,challenge)
            challenge=challenge['data']
            status,session=call('POST','/v1/auth/email/verify',{'challenge_id':challenge['challenge_id'],'code':challenge['local_code']})
            assert status==200,(status,session)
            session=session['data'];session['destination']=destination;session['challenge']=challenge
            cls.accounts.append(session)
            profile={'display_name':f'Test member {i}','date_of_birth':'1994-01-01','bio':'Synthetic local test account.','gender':'nonbinary','relationship_intent':'serious','interests':['Hiking','Coffee'],'languages':['English'],'location':{'latitude':40.71,'longitude':-74.01,'city':'New York'},'complete':True}
            status,result=call('PATCH','/v1/me',profile,session['access_token'])
            assert status==200,(status,result)
    def token(self,i):return self.accounts[i]['access_token']
    def swipe(self,a,b,action='like',key=None):return call('POST','/v1/swipes',{'target_id':self.accounts[b]['user_id'],'action':action},self.token(a),{'Idempotency-Key':key or str(uuid.uuid4())})
    def test_01_authentication_and_private_fields(self):
        self.assertEqual(call('GET','/v1/me')[0],401)
        status,result=call('GET','/v1/me',token=self.token(0));self.assertEqual(status,200);self.assertEqual(result['data']['profile']['display_name'],'Test member 0')
        status,result=call('GET','/v1/profiles/'+self.accounts[1]['user_id'],token=self.token(0));self.assertEqual(status,200);self.assertNotIn('date_of_birth',result['data']);self.assertNotIn('latitude',result['data'])
    def test_02_otp_replay_and_throttling(self):
        a=self.accounts[0];self.assertEqual(call('POST','/v1/auth/email/verify',{'challenge_id':a['challenge']['challenge_id'],'code':a['challenge']['local_code']})[0],400)
        self.assertEqual(call('POST','/v1/auth/email/start',{'destination':a['destination']})[0],429)
    def mutate_fixture(self,sql):
        runtime={**os.environ,'XDG_CONFIG_HOME':'/tmp/anvaya-config','WRANGLER_LOG_PATH':'/tmp/anvaya-integration-wrangler.log','WRANGLER_SEND_METRICS':'false'}
        subprocess.run([str(ROOT/'node_modules/.bin/wrangler'),'d1','execute','anvaya-local','--local','--persist-to',STATE.name,'--command',sql],cwd=API,env=runtime,check=True,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
    def test_02b_invalid_attempt_limit(self):
        status,d=call('POST','/v1/auth/email/start',{'destination':f'invalid-{uuid.uuid4()}@example.invalid'});self.assertEqual(status,202)
        d=d['data'];wrong='000000' if d['local_code']!='000000' else '999999'
        for _ in range(5):self.assertEqual(call('POST','/v1/auth/email/verify',{'challenge_id':d['challenge_id'],'code':wrong})[0],400)
        self.assertEqual(call('POST','/v1/auth/email/verify',{'challenge_id':d['challenge_id'],'code':d['local_code']})[0],400)
    def test_02c_expired_otp(self):
        status,d=call('POST','/v1/auth/email/start',{'destination':f'expired-{uuid.uuid4()}@example.invalid'});self.assertEqual(status,202)
        d=d['data'];self.mutate_fixture("UPDATE email_verifications SET expires_at=0 WHERE id='"+d['challenge_id']+"'")
        self.assertEqual(call('POST','/v1/auth/email/verify',{'challenge_id':d['challenge_id'],'code':d['local_code']})[0],400)
    def test_02d_phone_signup_and_verified_identity_linking(self):
        status,d=call('POST','/v1/auth/phone/start',{'destination':'+15555550101'});self.assertEqual(status,202);d=d['data']
        status,session=call('POST','/v1/auth/phone/verify',{'challenge_id':d['challenge_id'],'code':d['local_code']});self.assertEqual(status,200);self.assertNotEqual(session['data']['user_id'],self.accounts[0]['user_id'])
        status,d=call('POST','/v1/auth/phone/start',{'destination':'+15555550102'});self.assertEqual(status,202);d=d['data']
        status,_=call('POST','/v1/auth/link/phone',{'challenge_id':d['challenge_id'],'code':d['local_code']},self.token(0));self.assertEqual(status,200)
        self.assertEqual({i['provider'] for i in call('GET','/v1/me',token=self.token(0))[1]['data']['identities']},{'email','phone'})
    def test_03_underage_and_mass_assignment(self):
        status,result=call('PATCH','/v1/me',{'display_name':'Minor','date_of_birth':'2015-01-01','bio':'','gender':'nonbinary','relationship_intent':'serious','interests':[],'languages':['English'],'location':{'latitude':40,'longitude':-74,'city':'NY'},'complete':True},self.token(0))
        self.assertEqual(status,403);self.assertEqual(result['error']['code'],'ADULTS_ONLY')
        self.assertEqual(call('PATCH','/v1/me',{'status':'active','age_assured_at':1},self.token(0))[0],400)
    def test_04_discovery_and_preference_exclusion(self):
        status,result=call('GET','/v1/discover',token=self.token(0));self.assertEqual(status,200);self.assertEqual(len(result['data']),5)
        self.assertTrue(result['data'][0]['compatibility']['highlights'])
        pref={'min_age':70,'max_age':99,'genders':[],'radius_km':50,'intentions':[]}
        self.assertEqual(call('PATCH','/v1/preferences',pref,self.token(0))[0],200)
        self.assertEqual(call('GET','/v1/discover',token=self.token(0))[1]['data'],[])
        pref['min_age']=18;pref['max_age']=99;call('PATCH','/v1/preferences',pref,self.token(0))
    def test_05_reciprocal_concurrency_and_idempotency(self):
        self.assertEqual(self.swipe(0,1)[0],200)
        self.assertEqual(len(call('GET','/v1/matches',token=self.token(0))[1]['data']),0)
        with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
            results=list(pool.map(lambda _:self.swipe(1,0),range(4)))
        self.assertTrue(all(status==200 for status,_ in results),results)
        matches=call('GET','/v1/matches',token=self.token(0))[1]['data'];self.assertEqual(len(matches),1)
        self.__class__.conversation=matches[0]['id']
        self.assertEqual(call('GET','/v1/matches',token=self.token(1))[1]['data'][0]['id'],self.conversation)
        key=str(uuid.uuid4());first=self.swipe(0,2,key=key);self.assertEqual(first,self.swipe(0,2,key=key));self.assertEqual(self.swipe(0,3,key=key)[0],409)
    def test_06_persistent_messages_and_authorization(self):
        path=f'/v1/conversations/{self.conversation}/messages';client=str(uuid.uuid4())
        status,sent=call('POST',path,{'client_id':client,'body':'Hello from a real local Worker.'},self.token(0));self.assertEqual(status,200,sent)
        self.assertEqual(call('POST',path,{'client_id':client,'body':'Hello from a real local Worker.'},self.token(0))[1]['data']['id'],sent['data']['id'])
        status,history=call('GET',path,token=self.token(1));self.assertEqual(status,200);self.assertEqual(len(history['data']),1)
        self.assertEqual(call('GET',path,token=self.token(2))[0],404)
        self.assertEqual(call('POST',path,{'client_id':str(uuid.uuid4()),'body':'Intrusion'},self.token(2))[0],404)
    def test_06b_realtime_delivery_and_restart_persistence(self):
        global process
        runtime={**os.environ,'TEST_BASE':BASE,'TEST_CONVERSATION':self.conversation,'TEST_TOKEN':self.token(0),'TEST_OTHER_TOKEN':self.token(1)}
        subprocess.run(['node','tests/integration/realtime.mjs'],cwd=ROOT,env=runtime,check=True,timeout=30)
        import signal
        os.killpg(process.pid,signal.SIGTERM);process.wait(timeout=10)
        runtime={**os.environ,'XDG_CONFIG_HOME':'/tmp/anvaya-config','WRANGLER_LOG_PATH':'/tmp/anvaya-integration-wrangler.log','WRANGLER_SEND_METRICS':'false'}
        process=subprocess.Popen([str(ROOT/'node_modules/.bin/wrangler'),'dev','--local','--ip','127.0.0.1','--port',str(PORT),'--persist-to',STATE.name],cwd=API,env=runtime,stdout=log,stderr=subprocess.STDOUT,start_new_session=True)
        for _ in range(100):
            try:
                if call('GET','/health')[0]==200:break
            except (OSError,urllib.error.URLError):pass
            time.sleep(.2)
        status,result=call('GET',f'/v1/conversations/{self.conversation}/messages',token=self.token(1))
        self.assertEqual(status,200,result);self.assertEqual(len(result['data']),2)
        self.assertIn('real Durable Object',result['data'][1]['body'])
    def test_07_reports_rbac_audited_resolution(self):
        status,result=call('POST','/v1/reports',{'target_id':self.accounts[1]['user_id'],'category':'harassment','details':'Synthetic abuse report for integration testing.','conversation_id':self.conversation},self.token(0));self.assertEqual(status,201,result)
        self.assertEqual(call('GET','/v1/admin/cases')[0],401)
        headers={'x-local-admin':'development','x-local-role':'support'}
        self.assertEqual(call('GET','/v1/admin/cases',headers=headers)[0],403)
        headers['x-local-role']='moderator'
        self.assertEqual(call('GET','/v1/admin/cases',headers=headers)[0],200)
        self.assertEqual(call('PATCH','/v1/admin/cases/'+result['data']['case_id'],{'status':'resolved','resolution':'Reviewed synthetic evidence.','ban_user':False},headers=headers)[0],200)
    def test_08_premium_and_consumable_double_spend(self):
        self.assertEqual(call('POST','/v1/swipes/rewind',{},self.token(3))[0],403)
        status,_=call('POST','/v1/dev/entitlements',{'tier':'gold','duration_seconds':100,'super_likes':1,'boosts':1},self.token(3));self.assertEqual(status,200)
        self.assertEqual(call('PATCH','/v1/passport',{'city':'Paris','latitude':48.86,'longitude':2.35},self.token(3))[0],200)
        self.assertEqual(call('GET','/v1/discover',token=self.token(3))[1]['data'],[])
        self.assertEqual(call('PATCH','/v1/passport',{'city':None,'latitude':None,'longitude':None},self.token(3))[0],200)
        self.assertEqual(self.swipe(3,4,'super_like')[0],200)
        self.assertEqual(self.swipe(3,5,'super_like')[0],403)
        key=str(uuid.uuid4());redemption={'kind':'boost','idempotency_key':key}
        self.assertEqual(call('POST','/v1/consumables/redeem',redemption,self.token(3))[0],200)
        self.assertEqual(call('POST','/v1/consumables/redeem',redemption,self.token(3))[0],200)
        self.assertEqual(call('POST','/v1/consumables/redeem',{'kind':'boost','idempotency_key':str(uuid.uuid4())},self.token(3))[0],403)
        call('POST','/v1/dev/entitlements',{'tier':'gold','duration_seconds':0},self.token(3))
        self.assertEqual(call('GET','/v1/entitlements',token=self.token(3))[1]['data']['tier'],'free')
    def test_09_media_quarantine_and_invalid_upload(self):
        status,intent=call('POST','/v1/me/photos/upload-intent',{},self.token(0));self.assertEqual(status,201)
        d=intent['data'];self.assertEqual(call('GET','/v1/photos/'+d['photo_id'],token=self.token(1))[0],404)
        request=urllib.request.Request(BASE+d['upload_path'],data=b'<script>not a photograph</script>',method='PUT',headers={'Authorization':'Bearer '+self.token(0),'X-Upload-Token':d['upload_token']})
        with self.assertRaises(urllib.error.HTTPError) as ctx:urllib.request.urlopen(request)
        self.assertEqual(ctx.exception.code,415)
        self.assertEqual(call('POST','/v1/me/photos/complete',{'photo_id':d['photo_id']},self.token(0))[0],404)
    def test_09b_valid_photo_moderation_and_private_access(self):
        import base64
        image=base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD1sAAAAASUVORK5CYII=')
        status,intent=call('POST','/v1/me/photos/upload-intent',{},self.token(0));self.assertEqual(status,201)
        d=intent['data']
        req=urllib.request.Request(BASE+d['upload_path'],data=image,method='PUT',headers={'Authorization':'Bearer '+self.token(0),'X-Upload-Token':d['upload_token']})
        with urllib.request.urlopen(req) as res:self.assertEqual(res.status,200)
        self.assertEqual(call('POST','/v1/me/photos/complete',{'photo_id':d['photo_id']},self.token(0))[0],202)
        for _ in range(80):
            photos=call('GET','/v1/me/photos',token=self.token(0))[1]['data']
            if any(p['id']==d['photo_id'] and p['status']=='approved' for p in photos):break
            time.sleep(.2)
        else:self.fail('Local mock moderation did not approve queued image')
        req=urllib.request.Request(BASE+'/v1/photos/'+d['photo_id'],headers={'Authorization':'Bearer '+self.token(1)})
        with urllib.request.urlopen(req) as res:self.assertEqual(res.read(),image)
        self.assertEqual(call('DELETE','/v1/me/photos/'+d['photo_id'],token=self.token(1))[0],404)
        self.assertEqual(call('DELETE','/v1/me/photos/'+d['photo_id'],token=self.token(0))[0],200)
    def test_10_block_removes_all_interactions(self):
        target=self.accounts[1]['user_id'];self.assertEqual(call('POST',f'/v1/users/{target}/block',{},self.token(0))[0],200)
        self.assertEqual(call('GET','/v1/profiles/'+target,token=self.token(0))[0],404)
        self.assertEqual(call('GET',f'/v1/conversations/{self.conversation}/messages',token=self.token(1))[0],404)
        self.assertEqual(call('GET','/v1/matches',token=self.token(1))[1]['data'],[])
        self.assertEqual(self.swipe(1,0)[0],404)
    def test_11_export_and_delete(self):
        status,export=call('POST','/v1/me/data-export',{},self.token(4));self.assertEqual(status,200);self.assertEqual(export['data']['profile']['display_name'],'Test member 4')
        self.assertEqual(call('DELETE','/v1/me',token=self.token(4))[0],200)
        self.assertEqual(call('GET','/v1/me',token=self.token(4))[0],401)
    def test_12_refresh_rotation_and_replay(self):
        self.mutate_fixture("UPDATE refresh_sessions SET access_expires=0 WHERE user_id='"+self.accounts[5]['user_id']+"'");self.assertEqual(call('GET','/v1/me',token=self.token(5))[0],401)
        old=self.accounts[5]['refresh_token'];status,res=call('POST','/v1/auth/refresh',{'refresh_token':old});self.assertEqual(status,200,res)
        fresh=res['data'];self.assertEqual(call('GET','/v1/me',token=self.token(5))[0],401)
        self.assertEqual(call('GET','/v1/me',token=fresh['access_token'])[0],200)
        self.assertEqual(call('POST','/v1/auth/refresh',{'refresh_token':old})[0],401)
        self.assertEqual(call('GET','/v1/me',token=fresh['access_token'])[0],401)
    def test_13_providers_fail_closed(self):
        self.assertEqual(call('POST','/v1/purchases/sync',{'signed_transaction':'not-an-authentic-apple-transaction'},self.token(2))[0],503)
        self.assertEqual(call('POST','/v1/auth/apple',{'identity_token':'not-an-authentic-apple-token','nonce':'a'*32})[0],401)
if __name__=='__main__':unittest.main(verbosity=2)
