// No se importa config/db ni se crean cuentas reales.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const { createRequire } = require('node:module');
function cargar(archivo, deps) {
    const nombre = path.resolve(__dirname,'..',archivo), modulo = {exports:{}}, real = createRequire(nombre);
    const seguro = id => {
        if (Object.hasOwn(deps,id)) return deps[id];
        if (/config\/db|Model|model|Service|Controller/i.test(id)) throw Error('Dependencia real no permitida: '+id);
        return real(id);
    };
    vm.runInThisContext(`(function(require,module,exports){${fs.readFileSync(nombre,'utf8')}\n})`)(seguro,modulo,modulo.exports);
    return modulo.exports;
}
function servicio(persistir = async()=>4) {
    let ahora = 1000000; const temporizadores=[];
    const modulo=cargar('services/registroService.js',{'../models/registroModel':{crearConPreferencias:persistir}});
    const s=modulo.crearServicio({persistir,reloj:()=>ahora,programar:fn=>{temporizadores.push(fn);return{unref(){}};}});
    return {s,modulo,avanzar:ms=>ahora+=ms,temporizadores};
}
function req(id='sesion-A') { return {sessionID:id,session:{},body:{}}; }
function res() { return{statusCode:200,status(x){this.statusCode=x;return this},json(x){this.body=x;return this},redirect(x){this.destino=x;return this},set(){return this}}; }

for(const [nombre,alergias,intolerancias] of [['sin restricciones',[],[]],['alergias',[1,1],[]],['intolerancias',[],[2,2]],['ambas',[1],[2]]]) {
    test('registro normal '+nombre+' crea una vez y deduplica IDs',async()=>{
        const llamadas=[];const {s}=servicio(async(...args)=>{llamadas.push(args);return 4;});const r=req();
        const pendiente=s.preparar(r,'normal',{contrasena_hash:'hash-ficticio'});
        assert.equal(llamadas.length,0);assert.equal(r.session.usuario,undefined);
        r.body={token:pendiente.token,alergias,intolerancias,id_usuario:999};
        const [a,b]=await Promise.all([s.finalizar(r),s.finalizar(r)]);
        assert.equal(a.redirect,'/usuarios/login');assert.deepEqual(a,b);assert.equal(llamadas.length,1);
        assert.deepEqual(llamadas[0][2],{alergias:[...new Set(alergias)],intolerancias:[...new Set(intolerancias)]});
        await s.finalizar(r);assert.equal(llamadas.length,1);assert.equal(s.estado(r).completado,true);
        assert.equal(s.marcarNotificado(r),true);assert.equal(s.marcarNotificado(r),false);
    });
}
test('cancelar confirmación no crea cuenta; error permite reintentar con las selecciones',async()=>{
    let intentos=0;const {s}=servicio(async()=>{if(++intentos===1)throw Error('fallo simulado');return 4;});const r=req();
    const p=s.preparar(r,'normal',{contrasena_hash:'hash'});assert.equal(intentos,0);
    r.body={token:p.token,alergias:[1],intolerancias:[2]};await assert.rejects(s.finalizar(r));
    assert.deepEqual(s.estado(r).seleccion,{alergias:[1],intolerancias:[2]});assert.equal(s.estado(r).pendiente,true);
    await s.finalizar(r);assert.equal(intentos,2);
});
test('tokens no se mezclan entre sesiones; caducidad y reinicio no crean cuentas',async()=>{
    let escrituras=0;const e=servicio(async()=>escrituras++),r=req(),p=e.s.preparar(r,'google',{googleId:'uid-verificado'});
    const ajena=req('sesion-B');ajena.session.registroPendiente=p.token;ajena.body={token:p.token,alergias:[],intolerancias:[]};
    await assert.rejects(e.s.finalizar(ajena),{status:403});
    r.body=ajena.body;e.avanzar(15*60*1000+1);await assert.rejects(e.s.finalizar(r),{status:403});
    assert.equal(e.s.estado(r).pendiente,false);assert.equal(escrituras,0);
    assert.equal(servicio().s.estado(r).pendiente,false);
});
test('IDs inválidos y sesión autenticada no permiten finalizar otra cuenta',async()=>{
    let escrituras=0;const {s}=servicio(async()=>escrituras++),r=req(),p=s.preparar(r,'normal',{});
    for(const valor of [[0],[-1],[1.5],['abc'],[true],null]){
        r.body={token:p.token,alergias:valor,intolerancias:[]};await assert.rejects(s.finalizar(r),{status:400});
    }
    r.session.usuario={id_usuario:9};r.body={token:p.token,alergias:[],intolerancias:[]};
    await assert.rejects(s.finalizar(r),{status:409});assert.equal(escrituras,0);
});
function transaccionAislada(fallar=false) {
    const datos={cuentas:[],preferencias:[],eventos:[]};let copia;
    const c={beginTransaction:async()=>{datos.eventos.push('begin');copia=structuredClone({cuentas:datos.cuentas,preferencias:datos.preferencias});},
        commit:async()=>datos.eventos.push('commit'),rollback:async()=>{Object.assign(datos,copia);datos.eventos.push('rollback');},release:()=>datos.eventos.push('release')};
    const crear=async(d,con)=>{assert.equal(con,c);datos.cuentas.push(d);return 4;};
    const m=cargar('models/registroModel.js',{
        '../config/db':{getConnection:async()=>c},'./userModel':{crearUsuario:crear},
        './firebaseModel':{crearUsuarioGoogle:async(d,con)=>({id_usuario:await crear(d,con)})},
        './preferenciasModel':{guardarPreferencias:async(id,a,i,con)=>{assert.equal(con,c);assert.equal(id,4);if(fallar)throw Error('fallo preferencias');datos.preferencias.push({id,a,i});}},
        './catalogomodel':{obtenerAlergias:async con=>{assert.equal(con,c);return[{id_alergia:1}]},obtenerIntolerancias:async()=>[{id_intolerancia:2}]}
    });return{m,datos};
}
for(const tipo of ['normal','google'])test('cuenta '+tipo+' y preferencias comparten commit/rollback',async()=>{
    const a=transaccionAislada();assert.equal(await a.m.crearConPreferencias(tipo,{}, {alergias:[1],intolerancias:[2]}),4);
    assert.equal(a.datos.cuentas.length,1);assert.equal(a.datos.preferencias.length,1);assert.deepEqual(a.datos.eventos,['begin','commit','release']);
    const b=transaccionAislada(true);await assert.rejects(b.m.crearConPreferencias(tipo,{}, {alergias:[1],intolerancias:[2]}));
    assert.equal(b.datos.cuentas.length,0);assert.equal(b.datos.preferencias.length,0);assert.deepEqual(b.datos.eventos,['begin','rollback','release']);
});
test('un ID ajeno al catálogo se rechaza antes de insertar la cuenta',async()=>{
    const {m,datos}=transaccionAislada();await assert.rejects(m.crearConPreferencias('normal',{}, {alergias:[999],intolerancias:[]}),{status:400});assert.equal(datos.cuentas.length,0);
});
test('guardarPreferencias conserva su transacción propia y permite una externa',async()=>{
    const eventos=[];const c={query:async q=>{eventos.push(q.split(' ')[0]);return[[]]},beginTransaction:async()=>eventos.push('begin'),commit:async()=>eventos.push('commit'),rollback:async()=>eventos.push('rollback'),release:()=>eventos.push('release')};
    const m=cargar('models/preferenciasModel.js',{'../config/db':{getConnection:async()=>c}});
    await m.guardarPreferencias(4,[],[]);assert.ok(eventos.includes('begin'));assert.ok(eventos.includes('commit'));assert.ok(eventos.includes('release'));
    eventos.length=0;await m.guardarPreferencias(4,[1],[2],c);assert.equal(eventos.includes('begin'),false);assert.equal(eventos.includes('commit'),false);assert.equal(eventos.includes('release'),false);
});
test('modelos de cuenta y catálogos usan la conexión opcional sin consultar el pool',async()=>{
    const fallo=()=>assert.fail('No utilizar otra conexión');let cuenta=0;
    const con={query:async q=>q.trim().startsWith('INSERT')?[{insertId:++cuenta}]:[[{id_usuario:cuenta}]]};
    const normal=cargar('models/userModel.js',{'../config/db':{query:fallo}});
    assert.equal(await normal.crearUsuario({},con),1);
    const google=cargar('models/firebaseModel.js',{'../config/db':{query:fallo}});
    assert.equal((await google.crearUsuarioGoogle({},con)).id_usuario,2);
    const cat=cargar('models/catalogomodel.js',{'../config/db':{query:fallo}});await cat.obtenerAlergias(con);await cat.obtenerIntolerancias(con);
});
function controladores() {
    const e=servicio();const deps={'../services/registroService':e.s,'./registroController':{comprobarOrigen(){}},'../services/emailService':{},
        bcrypt:{hashSync:()=> 'hash',hash:async()=> 'hash-no-plano',compare:async()=>true},'../models/userModel':{buscarPorCorreo:async()=>null}};
    const normal=cargar('controllers/userController.js',deps);
    const google=cargar('controllers/FirebaseController.js',{'../models/firebaseModel':{buscarPorCorreo:async()=>null,buscarPorGoogleId:async()=>null},'../services/registroService':e.s,'./registroController':{comprobarOrigen(){}}});
    return{normal,google,e};
}
test('registro normal valida antes de preparar y no crea sesión autenticada',async()=>{
    const {normal,e}=controladores(),r=req(),mensajes={};r.get=()=> 'application/json';r.flash=(tipo,texto)=>{if(texto){(mensajes[tipo]||=[]).push(texto);return}const d=mensajes[tipo]||[];mensajes[tipo]=[];return d;};
    r.body={nombres:'Nuevo',apellidos:'Usuario',correo:'nuevo@example.invalid',password:'clave-simulada',Terminos:'Terminos'};
    const a=res();await normal.register(r,a);assert.equal(a.statusCode,202);assert.equal(e.s.estado(r).tipo,'normal');assert.equal(r.session.usuario,undefined);
    const b=req();b.get=r.get;b.flash=r.flash;b.body={...r.body,password:'corta'};
    const salida=res();await normal.register(b,salida);assert.equal(salida.statusCode,400);assert.equal(e.s.estado(b).pendiente,false);
});
test('Google nuevo conserva identidad verificada pero no inicia sesión ni crea cuenta antes de confirmar',async()=>{
    const {google,e}=controladores(),r=req();r.firebaseGoogleUser={googleId:'uid-seguro',correo:'verificado@example.invalid'};
    r.body={nombres:'Nueva',apellidos:'Cuenta',correo:'ignorado@example.invalid',googleId:'uid-falso',Terminos:'Terminos'};
    const salida=res();await google.registrarGoogle(r,salida);assert.equal(salida.statusCode,202);assert.equal(e.s.estado(r).tipo,'google');assert.equal(r.session.usuario,undefined);
});
test('loginGoogle de usuarios existentes conserva el acceso habitual',async()=>{
    const usuario={id_usuario:7,google_id:'uid-existente'};
    const c=cargar('controllers/FirebaseController.js',{'../models/firebaseModel':{buscarPorCorreo:async()=>usuario,buscarPorGoogleId:async()=>usuario},'../services/registroService':{},'./registroController':{}});
    const r=req();r.flash=()=>{};r.firebaseGoogleUser={googleId:'uid-existente',correo:'existente@example.invalid',fotoGoogle:null};
    const salida=res();await c.loginGoogle(r,salida);assert.equal(salida.body.ok,true);assert.equal(r.session.usuario.id_usuario,7);
});
test('confirmación es interna, no elimina selecciones ni depende del confirmador de otros modales',()=>{
    const js=fs.readFileSync(path.resolve(__dirname,'../public/Js/registroPreferencias.js'),'utf8');
    assert.doesNotMatch(js,/localStorage\.(?:getItem|setItem|removeItem)|confirmarAccionCookIQ\(|window\.confirm|alert\(/);
    assert.match(js,/confirmacion.hidden = true; seleccion.hidden = false/);assert.match(js,/pendiente.token/);
    const perfil=fs.readFileSync(path.resolve(__dirname,'../views/perfil.ejs'),'utf8');assert.doesNotMatch(perfil,/id="abrirPersonalizacionPerfil"/);
    assert.match(perfil,/id="opcionesAlergias"/);assert.match(perfil,/id="opcionesIntolerancias"/);
    const css=fs.readFileSync(path.resolve(__dirname,'../public/Css/preferencias.css'),'utf8');assert.match(css,/max-width:540px/);assert.match(css,/prefers-reduced-motion/);assert.match(css,/data-tema="oscuro"/);
});

test('interfaz conserva casillas al cancelar y ante error; solo redirige tras confirmación exitosa',async()=>{
    const elementos={};const nuevo=()=>({children:[],hidden:false,disabled:false,value:'',listeners:{},
        setAttribute(){},focus(){},addEventListener(k,v){this.listeners[k]=v},replaceChildren(){this.children=[]},append(...n){this.children.push(...n)}});
    for(const id of ['personalizacionRegistro','formRegistro','mensajePreferenciasRegistro','seleccionPreferenciasRegistro','confirmacionPreferenciasRegistro',
        'recargarCatalogosRegistro','confirmarPreferenciasRegistro','tituloPersonalizacionRegistro','formPreferenciasRegistro','tituloConfirmacionPreferencias',
        'cancelarConfirmacionPreferencias','guardarPreferenciasRegistro','errorRegistroPreferencias','registroAlergias','registroIntolerancias'])elementos[id]=nuevo();
    const d=elementos.personalizacionRegistro;d.showModal=()=>d.open=true;
    const casillas=()=>['registroAlergias','registroIntolerancias'].flatMap(id=>elementos[id].children.flatMap(l=>l.children.filter(n=>n.type==='checkbox')));
    d.querySelectorAll=q=>casillas().filter(c=>q.includes('"'+c.name+'"')&&c.checked);
    const password={value:'clave-en-memoria'},enviar={};const f=elementos.formRegistro;f.action='/usuarios/registro';f.reportValidity=()=>true;
    f.querySelector=q=>q.includes('password')?password:enviar;
    let destino,escrituras=0;const peticiones=[];
    vm.runInNewContext(fs.readFileSync(path.resolve(__dirname,'../public/Js/registroPreferencias.js'),'utf8'),{
        document:{getElementById:id=>elementos[id],createElement:()=>nuevo()},window:{addEventListener(){},location:{assign:x=>destino=x}},
        FormData:class{*[Symbol.iterator](){yield['nombres','Nueva'];yield['password',password.value];}},
        fetch:async(url,op)=>{peticiones.push({url,op});let status=200,body={ok:true,pendiente:false};
            if(url==='/usuarios/registro')body={ok:true,token:'a'.repeat(64),tipo:'normal',pendiente:true};
            if(url==='/catalogos')body={alergias:[{id_alergia:1,nombre:'Alergia real'}],intolerancias:[{id_intolerancia:2,nombre:'Intolerancia real'}]};
            if(url==='/usuarios/registro/finalizar'){escrituras++;status=escrituras===1?503:200;body=escrituras===1?{ok:false,error:'Fallo simulado'}:{ok:true,redirect:'/usuarios/login'};}
            return{ok:status===200,status,json:async()=>body};}
    });
    await new Promise(r=>setImmediate(r));
    await f.listeners.submit({preventDefault(){}});assert.equal(password.value,'');assert.equal(d.open,true);
    casillas().forEach(c=>c.checked=true);
    elementos.formPreferenciasRegistro.listeners.submit({preventDefault(){}});
    elementos.cancelarConfirmacionPreferencias.listeners.click();assert.equal(casillas().every(c=>c.checked),true);assert.equal(escrituras,0);
    elementos.formPreferenciasRegistro.listeners.submit({preventDefault(){}});
    await elementos.guardarPreferenciasRegistro.listeners.click();assert.equal(destino,undefined);assert.equal(casillas().every(c=>c.checked),true);
    await elementos.guardarPreferenciasRegistro.listeners.click();assert.equal(destino,'/usuarios/login');
    const datos=JSON.parse(peticiones.find(p=>p.url.endsWith('/finalizar')).op.body);assert.deepEqual(datos.alergias,[1]);assert.deepEqual(datos.intolerancias,[2]);assert.equal(datos.id_usuario,undefined);
});

test('vistas de registro y perfil conservan campos y cargan tarjetas adaptables a ambos temas',async()=>{
    const ejs=require('ejs');const registro=await ejs.renderFile(path.resolve(__dirname,'../views/register.ejs'),{error:[],success:[],datosRegistro:{}});
    assert.match(registro,/id="personalizacionRegistro"/);assert.match(registro,/id="formRegistro"/);assert.match(registro,/id="formRegistroGoogle"/);
    assert.match(registro,/Continuar a preferencias/);assert.match(registro,/\/Js\/firebase-auth.js/);assert.match(registro,/\/Js\/tema.js/);
    const perfil=await ejs.renderFile(path.resolve(__dirname,'../views/perfil.ejs'),{planActual:{nombre:'MasterChef',masterchef:true},user:{correo:'prueba@example.invalid'}});
    assert.match(perfil,/id="opcionesAlergias"/);assert.match(perfil,/id="opcionesIntolerancias"/);assert.match(perfil,/id="abrirAjustesPerfil"/);assert.match(perfil,/href="\/suscripciones"/);
    assert.doesNotMatch(perfil,/id="abrirPersonalizacionPerfil"/);
});

test('preferencias persistidas se consultan por el ID autenticado para Perfil y generación',async()=>{
    const p=cargar('models/preferenciasModel.js',{'../config/db':{query:async(sql,ids)=>{
        assert.ok(ids.every(id=>id===4));
        if(sql.includes("SELECT 'alergia'"))return[[{tipo:'alergia',nombre:'Pescado'},{tipo:'intolerancia',nombre:'Lactosa'}]];
        return[sql.includes('SELECT id_alergia')?[{id_alergia:1}]:[{id_intolerancia:2}]];
    }}});
    assert.deepEqual(await p.obtenerPreferencias(4),{alergias:[1],intolerancias:[2]});
    assert.deepEqual(await p.obtenerRestricciones(4),{alergias:['Pescado'],intolerancias:['Lactosa']});
});

test('finalización verifica origen, notifica solo después del commit y no acepta ID del navegador',async()=>{
    const {s}=servicio();const r=req();const mensajes=[];
    const p=s.preparar(r,'normal',{});r.body={token:p.token,alergias:[],intolerancias:[],id_usuario:999};
    r.protocol='http';r.get=k=>k==='origin'?'http://localhost:3000':'localhost:3000';
    r.flash=(tipo,texto)=>mensajes.push({tipo,texto});r.session.save=fn=>fn();
    const c=cargar('controllers/registroController.js',{'../services/registroService':s});
    const a=res();await c.finalizar(r,a);assert.equal(a.body.ok,true);assert.equal(mensajes.length,1);
    const b=res();await c.finalizar(r,b);assert.equal(b.body.ok,true);assert.equal(mensajes.length,1);
    r.get=k=>k==='origin'?'https://ajeno.invalid':'localhost:3000';
    const ajena=res();await c.finalizar(r,ajena);assert.equal(ajena.statusCode,403);
});

test('frontend Google nuevo abre la ventana compartida sin redirigir al Lobby',()=>{
    const s=fs.readFileSync(path.resolve(__dirname,'../public/Js/firebase-auth.js'),'utf8');
    const inicio=s.indexOf("formularioRegistro?.addEventListener('submit'");
    const fin=s.indexOf('    botonGoogle.disabled = true;',inicio);
    const bloque=s.slice(inicio,fin);assert.ok(inicio>=0&&fin>inicio);
    assert.match(bloque,/await signOut\(auth\)/);assert.match(bloque,/window.CookIQRegistro.abrir\(resultado\)/);
    assert.doesNotMatch(bloque,/assign\('\/lobby'\)|actualizarPerfilLocal/);
    assert.match(s.slice(fin),/actualizarPerfilLocal\(respuesta.usuario\);\s*window.location.assign\('\/lobby'\)/);
});

test('borradores recuperan las selecciones sin SQL e ignoran respuestas fuera de orden',async()=>{
    let escrituras=0;const {s}=servicio(async()=>{escrituras++;return 4;}),r=req(),p=s.preparar(r,'normal',{});
    r.body={token:p.token,revision:2,alergias:[1,1],intolerancias:[2]};s.guardarBorrador(r);
    r.body={token:p.token,revision:1,alergias:[],intolerancias:[]};s.guardarBorrador(r);
    assert.deepEqual(s.estado(r).seleccion,{alergias:[1],intolerancias:[2]});assert.equal(s.estado(r).revision,2);assert.equal(escrituras,0);
    r.body={token:p.token,alergias:[1],intolerancias:[2]};await s.finalizar(r);
    r.body={token:p.token,revision:3,alergias:[],intolerancias:[]};s.guardarBorrador(r);
    assert.deepEqual(s.estado(r).seleccion,{alergias:[1],intolerancias:[2]});assert.equal(escrituras,1);
});
