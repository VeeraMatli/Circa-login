"""Deterministically generate the checked-in Xcode project. Standard library only."""
import hashlib,pathlib
ROOT=pathlib.Path(__file__).resolve().parents[1]/'apps/ios'
def uid(value):return hashlib.sha256(value.encode()).hexdigest()[:24].upper()
def q(value):return '"'+str(value).replace('\\','\\\\').replace('"','\\"')+'"'
objects={}
def add(key,body):objects[uid(key)]=body;return uid(key)
def refs(values):return '('+','.join(values)+(',' if values else '')+')'
def settings(d):return '{'+''.join(k+' = '+q(v)+';' for k,v in d.items())+'}'
project=uid('project');root_group=uid('root');products=uid('products');project_configs=uid('project-configs')
targets=[];product_refs=[];groups=[]
for target,subdir,product_type,extension in [('HeartTrail','HeartTrail','application','app'),('HeartTrailTests','HeartTrailTests','bundle.unit-test','xctest'),('HeartTrailUITests','HeartTrailUITests','bundle.ui-testing','xctest')]:
    files=[];builds=[]
    for path in sorted((ROOT/subdir).rglob('*.swift')):
        relative=str(path.relative_to(ROOT));fileid=add(relative,'{isa=PBXFileReference;lastKnownFileType=sourcecode.swift;path='+q(relative)+';sourceTree="<group>";}');files.append(fileid)
        builds.append(add(relative+'build','{isa=PBXBuildFile;fileRef='+fileid+';}'))
    if target=='HeartTrail':
        asset='HeartTrail/Resources/Assets.xcassets';fileid=add(asset,'{isa=PBXFileReference;lastKnownFileType=folder.assetcatalog;path='+q(asset)+';sourceTree="<group>";}');files.append(fileid)
        assetbuild=add(asset+'build','{isa=PBXBuildFile;fileRef='+fileid+';}')
        privacy='HeartTrail/Resources/PrivacyInfo.xcprivacy'; privacyfile=add(privacy,'{isa=PBXFileReference;lastKnownFileType=text.xml;path='+q(privacy)+';sourceTree="<group>";}');files.append(privacyfile)
        privacybuild=add(privacy+'build','{isa=PBXBuildFile;fileRef='+privacyfile+';}')
    if target=='HeartTrail':
        for extra,kind in [('HeartTrail/Resources/HeartTrail.storekit','text.json'),('HeartTrail/Resources/Info.plist','text.plist.xml'),('HeartTrail/Resources/HeartTrail.entitlements','text.plist.entitlements'),('HeartTrail/Resources/AppIcon.svg','image.svg')]:
            files.append(add(extra,'{isa=PBXFileReference;lastKnownFileType='+kind+';path='+q(extra)+';sourceTree="<group>";}'))
    group=add(target+'group','{isa=PBXGroup;children='+refs(files)+';name='+q(target)+';sourceTree="<group>";}');groups.append(group)
    product=add(target+'product','{isa=PBXFileReference;explicitFileType='+q('wrapper.application' if extension=='app' else 'wrapper.cfbundle')+';path='+q(target+'.'+extension)+';sourceTree=BUILT_PRODUCTS_DIR;}');product_refs.append(product)
    source=add(target+'sources','{isa=PBXSourcesBuildPhase;buildActionMask=2147483647;files='+refs(builds)+';runOnlyForDeploymentPostprocessing=0;}')
    frameworks=add(target+'frameworks','{isa=PBXFrameworksBuildPhase;buildActionMask=2147483647;files=();runOnlyForDeploymentPostprocessing=0;}')
    resources=add(target+'resources','{isa=PBXResourcesBuildPhase;buildActionMask=2147483647;files='+refs([assetbuild,privacybuild] if target=='HeartTrail' else [])+';runOnlyForDeploymentPostprocessing=0;}')
    configs=[]
    for configuration in ['Debug','Release']:
        d={'PRODUCT_NAME':'$(TARGET_NAME)','PRODUCT_BUNDLE_IDENTIFIER':'$(HEARTTRAIL_BUNDLE_ID)'+('' if target=='HeartTrail' else '.'+target),'SWIFT_VERSION':'6.0','SWIFT_STRICT_CONCURRENCY':'complete','IPHONEOS_DEPLOYMENT_TARGET':'17.0','SDKROOT':'iphoneos','TARGETED_DEVICE_FAMILY':'1,2','CODE_SIGN_STYLE':'Automatic','GENERATE_INFOPLIST_FILE':'YES','SWIFT_EMIT_LOC_STRINGS':'YES','SUPPORTED_PLATFORMS':'iphoneos iphonesimulator','HEARTTRAIL_BUNDLE_ID':'com.anvaya.dating'}
        if target=='HeartTrail':d.update({'GENERATE_INFOPLIST_FILE':'NO','INFOPLIST_FILE':'HeartTrail/Resources/Info.plist','CODE_SIGN_ENTITLEMENTS':'HeartTrail/Resources/HeartTrail.entitlements','ASSETCATALOG_COMPILER_APPICON_NAME':'AppIcon','API_BASE_URL':'http://127.0.0.1:8787' if configuration=='Debug' else 'https://api.example.invalid','APS_ENVIRONMENT':'development' if configuration=='Debug' else 'production','SWIFT_ACTIVE_COMPILATION_CONDITIONS':'DEBUG' if configuration=='Debug' else ''})
        elif target=='HeartTrailTests':d.update({'TEST_HOST':'$(BUILT_PRODUCTS_DIR)/HeartTrail.app/$(BUNDLE_EXECUTABLE_FOLDER_PATH)/HeartTrail','BUNDLE_LOADER':'$(TEST_HOST)'})
        else:d.update({'TEST_TARGET_NAME':'HeartTrail'})
        configs.append(add(target+configuration,'{isa=XCBuildConfiguration;buildSettings='+settings(d)+';name='+q(configuration)+';}'))
    conf=add(target+'configs','{isa=XCConfigurationList;buildConfigurations='+refs(configs)+';defaultConfigurationIsVisible=0;defaultConfigurationName=Release;}')
    dependencies=[]
    if target!='HeartTrail':
        proxy=add(target+'proxy','{isa=PBXContainerItemProxy;containerPortal='+project+';proxyType=1;remoteGlobalIDString='+uid('HeartTrailtarget')+';remoteInfo=HeartTrail;}')
        dependencies.append(add(target+'dependency','{isa=PBXTargetDependency;target='+uid('HeartTrailtarget')+';targetProxy='+proxy+';}'))
    targets.append(add(target+'target','{isa=PBXNativeTarget;buildConfigurationList='+conf+';buildPhases='+refs([source,frameworks,resources])+';buildRules=();dependencies='+refs(dependencies)+';name='+q(target)+';productName='+q(target)+';productReference='+product+';productType='+q('com.apple.product-type.'+product_type)+';}'))
add('products','{isa=PBXGroup;children='+refs(product_refs)+';name=Products;sourceTree="<group>";}')
add('root','{isa=PBXGroup;children='+refs(groups+[products])+';sourceTree="<group>";}')
configs=[add('project'+c,'{isa=XCBuildConfiguration;buildSettings={CLANG_ENABLE_MODULES=YES;SWIFT_OPTIMIZATION_LEVEL='+q('-Onone' if c=='Debug' else '-O')+';};name='+c+';}') for c in ['Debug','Release']]
add('project-configs','{isa=XCConfigurationList;buildConfigurations='+refs(configs)+';defaultConfigurationIsVisible=0;defaultConfigurationName=Release;}')
add('project','{isa=PBXProject;attributes={LastUpgradeCheck=1640;};buildConfigurationList='+project_configs+';compatibilityVersion="Xcode 14.0";developmentRegion=en;knownRegions=(en,Base);mainGroup='+root_group+';productRefGroup='+products+';projectDirPath="";projectRoot="";targets='+refs(targets)+';}')
project_dir=ROOT/'HeartTrail.xcodeproj';project_dir.mkdir(exist_ok=True)
(project_dir/'project.pbxproj').write_text('// !$*UTF8*$!\n{archiveVersion=1;classes={};objectVersion=56;objects={\n'+''.join(k+' = '+v+';\n' for k,v in objects.items())+'};rootObject='+project+';}\n')
schemes=project_dir/'xcshareddata/xcschemes';schemes.mkdir(parents=True,exist_ok=True)
def ref(name):return f'<BuildableReference BuildableIdentifier="primary" BlueprintIdentifier="{uid(name+"target")}" BuildableName="{name}.{ "app" if name=="HeartTrail" else "xctest"}" BlueprintName="{name}" ReferencedContainer="container:HeartTrail.xcodeproj"/>'
(schemes/'HeartTrail.xcscheme').write_text('<?xml version="1.0" encoding="UTF-8"?><Scheme LastUpgradeVersion="1640" version="1.3"><BuildAction parallelizeBuildables="YES" buildImplicitDependencies="YES"><BuildActionEntries><BuildActionEntry buildForTesting="YES" buildForRunning="YES" buildForProfiling="YES" buildForArchiving="YES" buildForAnalyzing="YES">'+ref('HeartTrail')+'</BuildActionEntry></BuildActionEntries></BuildAction><TestAction buildConfiguration="Debug" selectedDebuggerIdentifier="Xcode.DebuggerFoundation.Debugger.LLDB" selectedLauncherIdentifier="Xcode.IDEFoundation.Launcher.LLDB" shouldUseLaunchSchemeArgsEnv="YES"><Testables>'+''.join('<TestableReference skipped="NO">'+ref(t)+'</TestableReference>' for t in ['HeartTrailTests','HeartTrailUITests'])+'</Testables></TestAction><LaunchAction buildConfiguration="Debug" selectedDebuggerIdentifier="Xcode.DebuggerFoundation.Debugger.LLDB" selectedLauncherIdentifier="Xcode.IDEFoundation.Launcher.LLDB" launchStyle="0" useCustomWorkingDirectory="NO" ignoresPersistentStateOnLaunch="NO" debugDocumentVersioning="YES" debugServiceExtension="internal" allowLocationSimulation="YES"><BuildableProductRunnable runnableDebuggingMode="0">'+ref('HeartTrail')+'</BuildableProductRunnable></LaunchAction><ProfileAction buildConfiguration="Release" shouldUseLaunchSchemeArgsEnv="YES" savedToolIdentifier="" useCustomWorkingDirectory="NO" debugDocumentVersioning="YES"><BuildableProductRunnable runnableDebuggingMode="0">'+ref('HeartTrail')+'</BuildableProductRunnable></ProfileAction><AnalyzeAction buildConfiguration="Debug"/><ArchiveAction buildConfiguration="Release" revealArchiveInOrganizer="YES"/></Scheme>')
print('Generated',project_dir)
