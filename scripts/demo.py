"""Create synthetic users in the running LOCAL_MODE Worker. Never run against production."""
import json,urllib.request,uuid
base='http://127.0.0.1:8787'
def call(path,data,token=None,method='POST'):
 headers={'Content-Type':'application/json'}
 if token:headers['Authorization']='Bearer '+token
 request=urllib.request.Request(base+path,data=json.dumps(data).encode(),headers=headers,method=method)
 with urllib.request.urlopen(request) as response:return json.load(response)['data']
with urllib.request.urlopen(base+'/health') as response:
 assert json.load(response)['data']['mode']=='local-mocks','Synthetic data is restricted to local mocks.'
for name,gender in [('Demo Avery','nonbinary'),('Demo Morgan','woman'),('Demo Jordan','man')]:
 email='demo-'+uuid.uuid4().hex[:8]+'@example.invalid'
 challenge=call('/v1/auth/email/start',{'destination':email})
 session=call('/v1/auth/email/verify',{'challenge_id':challenge['challenge_id'],'code':challenge['local_code']})
 call('/v1/me',{'display_name':name,'date_of_birth':'1994-01-01','bio':'SYNTHETIC LOCAL DEVELOPMENT ACCOUNT.','gender':gender,'relationship_intent':'serious','interests':['Hiking','Coffee','Reading'],'languages':['English'],'location':{'latitude':40.71,'longitude':-74.01,'city':'New York'},'complete':True},session['access_token'],'PATCH')
 print(f'Created {name}. Sign in through local OTP using {email}.')
