// No importa config/db ni clientes reales. Todas las respuestas y escrituras son en memoria.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { randomUUID } = require('node:crypto');
const reglas = require('../services/paypalService');

function cargar(archivo,deps) {
    const nombre = path.resolve(__dirname,'..',archivo), modulo = {exports:{}}, real = createRequire(nombre);
    const requireSeguro = id => {
        if (Object.hasOwn(deps,id)) return deps[id];
        if (/config\/db|Model|openai|firebase/i.test(id)) throw new Error(`Dependencia no aislada: ${id}`);
        return real(id);
    };
    vm.runInThisContext(`(function(require,module,exports){${fs.readFileSync(nombre,'utf8')}\n})`,{filename:nombre})(requireSeguro,modulo,modulo.exports);
    return modulo.exports;
}
const env = { PAYPAL_SANDBOX_CLIENT_ID:'cliente-prueba',PAYPAL_SANDBOX_CLIENT_SECRET:'secreto-ficticio',
    PAYPAL_SANDBOX_PLAN_ID:reglas.PLAN,PAYPAL_SANDBOX_WEBHOOK_ID:'WHPRUEBA',PAYPAL_SANDBOX_BASE_URL:'https://cookiq-prueba.example' };
function fixtures() {
    const inicio = new Date(); inicio.setUTCHours(0,0,0,0);
    const ancla = inicio.toISOString(), proxima = new Date(inicio); proxima.setUTCMonth(proxima.getUTCMonth()+1);
    const local = {id_paypal_suscripcion:1,id_usuario:1,id_suscripcion:2,clave_operacion:randomUUID(),referencia_cliente:randomUUID(),
        paypal_subscription_id:'I-PRUEBA',paypal_plan_id:reglas.PLAN,moneda:'USD',importe:'1.00000000',creadaISO:ancla,estado_paypal:'ACTIVE'};
    const remota = { id:'I-PRUEBA',plan_id:reglas.PLAN,custom_id:local.referencia_cliente,status:'ACTIVE',start_time:ancla,update_time:ancla,
        billing_info:{cycle_executions:[{tenure_type:'REGULAR',cycles_completed:1}],last_payment:{time:ancla,amount:{currency_code:'USD',value:'1.00'}},next_billing_time:proxima.toISOString()} };
    const t = {id:'VENTA-1',status:'COMPLETED',time:ancla,amount_with_breakdown:{gross_amount:{currency_code:'USD',value:'1.00'}}};
    const venta = {id:t.id,billing_agreement_id:remota.id,state:'completed',amount:{currency:'USD',total:'1.00'}};
    const plan = {id:reglas.PLAN,product_id:reglas.PRODUCTO,status:'ACTIVE',quantity_supported:false,
        billing_cycles:[{tenure_type:'REGULAR',total_cycles:0,frequency:{interval_unit:'MONTH',interval_count:1},pricing_scheme:{fixed_price:{currency_code:'USD',value:'1.00'}}}],
        payment_preferences:{setup_fee:{value:'0.00',currency_code:'USD'}}};
    return {local,remota,t,venta,plan};
}
function snapshot(f = fixtures()) { return {remota:f.remota,cobros:reglas.evaluarCobros(f.remota,[f.t],new Map([[f.t.id,f.venta]]))}; }

function memoria() {
    const f = fixtures();
    const estado = {usuario:{id_usuario:1,id_suscripcion:1},operaciones:[{...f.local,estado_paypal:'APPROVAL_PENDING'}],
        contratos:[],cobros:[],fallarCobro:false,ahora:new Date(),sentencias:[]};
    let cola = Promise.resolve();
    function vigente(su) { const ahora = reglas.horaChile(estado.ahora); return su.estado==='activa'&&su.fecha_inicio<=ahora&&(!su.fecha_fin||su.fecha_fin>ahora); }
    async function ejecutar(sql,p = []) {
        const q = sql.replace(/\s+/g,' ').trim(); estado.sentencias.push(q);
        if(q.startsWith('SET TRANSACTION')) return [{}];
        if(q.startsWith('SELECT id_usuario,id_suscripcion FROM usuario')) return [[estado.usuario]];
        if(q.startsWith('SELECT id_suscripcion FROM suscripcion')) return [[{id_suscripcion:2}]];
        if(q.startsWith('SELECT p.*')) {
            let ops = estado.operaciones;
            if(q.includes('WHERE p.clave_operacion')) ops=ops.filter(o=>o.clave_operacion===p[0]&&o.id_usuario===p[1]);
            else if(q.includes('WHERE p.id_paypal_suscripcion')) ops=ops.filter(o=>o.id_paypal_suscripcion===p[0]);
            else if(q.includes('WHERE p.paypal_subscription_id')) ops=ops.filter(o=>o.paypal_subscription_id===p[0]);
            else if(q.includes('WHERE p.id_usuario')) ops=ops.filter(o=>o.id_usuario===p[0]&&(!q.includes('NOT IN')||!['CANCELLED','EXPIRED','LOCAL_FAILED'].includes(o.estado_paypal)));
            return [ops.map(o=>({...o}))];
        }
        if(q.startsWith('SELECT id_suscripcion_usuario FROM suscripcion_usuario')) {
            if(q.includes('id_suscripcion_usuario = ?')) return [estado.contratos.filter(s=>s.id_suscripcion_usuario===p[0]&&s.id_usuario===p[1]&&s.id_suscripcion===p[2]&&s.origen==='paypal_sandbox')];
            return [estado.contratos.filter(s=>s.id_usuario===p[0]&&s.id_suscripcion===p[1]&&vigente(s))];
        }
        if(q.startsWith('SELECT id_paypal_suscripcion FROM paypal_suscripcion')) return [estado.operaciones.map(o=>({id_paypal_suscripcion:o.id_paypal_suscripcion}))];
        if(q.startsWith('INSERT INTO paypal_suscripcion')) {
            estado.operaciones.push({id_paypal_suscripcion:estado.operaciones.length+1,id_usuario:p[0],id_suscripcion:p[1],clave_operacion:p[2],referencia_cliente:p[3],paypal_plan_id:p[4],moneda:'USD',importe:'1.00',estado_paypal:'CREATING',creadaISO:estado.ahora.toISOString()}); return [{insertId:estado.operaciones.length}];
        }
        if(q.startsWith('SELECT DATE_FORMAT(UTC_TIMESTAMP()')) return [[{utc:estado.ahora.toISOString(),local:reglas.horaChile(estado.ahora)}]];
        if(q.startsWith('SELECT pc.*')) return [estado.cobros.filter(c=>c.paypal_transaction_id===p[0]).map(c=>({...c,desdeISO:c.desde,hastaISO:c.hasta}))];
        if(q.startsWith('INSERT INTO paypal_cobro')) {
            if(estado.fallarCobro) throw new Error('Fallo de escritura simulado');
            assert.ok(!estado.cobros.some(c=>c.paypal_transaction_id===p[1]));
            estado.cobros.push({id_paypal_cobro:estado.cobros.length+1,id_paypal_suscripcion:p[0],paypal_transaction_id:p[1],estado:p[2],ocurrido:p[3],
                desde:p[4]?p[4].replace(' ','T')+'Z':null,hasta:p[5]?p[5].replace(' ','T')+'Z':null}); return [{insertId:estado.cobros.length}];
        }
        if(q.startsWith('UPDATE paypal_cobro')) {
            const c=estado.cobros.find(c=>c.id_paypal_cobro===p[3]); Object.assign(c,{estado:p[0],desde:p[1]?p[1].replace(' ','T')+'Z':null,hasta:p[2]?p[2].replace(' ','T')+'Z':null}); return [{affectedRows:1}];
        }
        if(q.startsWith('SELECT estado,DATE_FORMAT')) return [estado.cobros.filter(c=>c.id_paypal_suscripcion===p[0]).map(c=>({estado:c.estado,desde:c.desde,hasta:c.hasta}))];
        if(q.startsWith('INSERT INTO suscripcion_usuario')) {
            const id=estado.contratos.length+10; estado.contratos.push({id_suscripcion_usuario:id,id_usuario:p[0],id_suscripcion:p[1],fecha_inicio:p[2],fecha_fin:p[3],estado:'activa',origen:'paypal_sandbox'}); return [{insertId:id}];
        }
        if(q.startsWith('UPDATE suscripcion_usuario')) {
            const id=q.includes("estado = 'activa'")?p[2]:p[0];
            const s=estado.contratos.find(s=>s.id_suscripcion_usuario===id&&s.origen==='paypal_sandbox'); assert.ok(s);
            if(p.length===3) Object.assign(s,{estado:'activa',fecha_inicio:p[0],fecha_fin:p[1]}); else s.estado='vencida';
            return [{affectedRows:1}];
        }
        if(q.startsWith('UPDATE paypal_suscripcion SET id_suscripcion_usuario')) {
            const o=estado.operaciones.find(o=>o.id_paypal_suscripcion===p[4]);
            Object.assign(o,{id_suscripcion_usuario:p[0],estado_paypal:p[1],pagado_hasta:p[2],actualizadaISO:p[3].replace(' ','T')+'Z',sincronizadaISO:estado.ahora.toISOString()}); return [{affectedRows:1}];
        }
        if(q.startsWith('UPDATE paypal_suscripcion SET paypal_subscription_id')) {
            const o=estado.operaciones.find(o=>o.id_paypal_suscripcion===p[2]); Object.assign(o,{paypal_subscription_id:p[0],estado_paypal:p[1]}); return [{affectedRows:1}];
        }
        if(q.startsWith('UPDATE paypal_suscripcion p JOIN usuario')) {
            const o=estado.operaciones.find(o=>o.id_paypal_suscripcion===p[0]&&o.id_usuario===p[1]);
            const su=estado.contratos.find(s=>s.id_suscripcion_usuario===o?.id_suscripcion_usuario&&s.origen==='paypal_sandbox'&&vigente(s));
            const cobro=estado.cobros.some(c=>c.id_paypal_suscripcion===o?.id_paypal_suscripcion&&c.estado==='COMPLETED'
                &&c.desde&&c.hasta&&new Date(c.desde)<=estado.ahora&&new Date(c.hasta)>estado.ahora);
            if(!o||o.compra_notificada_en||!su||!cobro||estado.usuario.id_suscripcion!==2)return[{affectedRows:0}];
            o.compra_notificada_en=estado.ahora.toISOString();return[{affectedRows:1}];
        }
        if(q.startsWith('SELECT su.id_suscripcion')) return [estado.contratos.filter(s=>vigente(s)).map(s=>({id_suscripcion:s.id_suscripcion}))];
        if(q.startsWith('UPDATE usuario SET id_suscripcion')) {
            if(estado.fallarActualizacionUsuario) return [{affectedRows:0}];
            estado.usuario.id_suscripcion=p[0];return [{affectedRows:1}];
        }
        throw new Error(`SQL no simulado: ${q}`);
    }
    const pool = {execute:ejecutar,query:ejecutar,getConnection:async()=>{
        let copia,liberar;
        return {execute:ejecutar,query:ejecutar,beginTransaction:async()=>{const previa=cola;cola=new Promise(r=>{liberar=r;});await previa;
            copia=structuredClone({usuario:estado.usuario,operaciones:estado.operaciones,contratos:estado.contratos,cobros:estado.cobros});},
        commit:async()=>liberar(),rollback:async()=>{Object.assign(estado,copia);liberar();},release(){}};
    }};
    const modelo = cargar('models/paypalModel.js',{'../config/db':pool});
    return {f,estado,modelo,masterchef:()=>estado.usuario.id_suscripcion===2&&estado.contratos.some(s=>vigente(s))};
}
function respuesta() {
    return {statusCode:200,headers:{},set(k,v){this.headers[k]=v;return this;},status(n){this.statusCode=n;return this;},json(d){this.body=d;return this;},redirect(url){this.destino=url;return this;},sendStatus(n){this.statusCode=n;return this;}};
}
function controlador(deps) {
    return cargar('controllers/paypalController.js',{'../models/paypalModel':{},'../models/suscripcionModel':{obtenerPlan:async()=>({masterchef:false})}}).crearControlador(deps);
}

test('configuración pendiente bloquea contratación; solo acepta plan y origen autorizados',()=>{
    assert.equal(reglas.configuracion(env).listaParaContratar,true);
    for(const clave of ['PAYPAL_SANDBOX_WEBHOOK_ID','PAYPAL_SANDBOX_BASE_URL']) assert.equal(reglas.configuracion({...env,[clave]:''}).listaParaContratar,false);
    assert.equal(reglas.configuracion({...env,PAYPAL_SANDBOX_BASE_URL:'http://localhost:3000'}).listaParaContratar,true);
    assert.equal(reglas.configuracion({...env,PAYPAL_SANDBOX_BASE_URL:'http://localhost:3000',NODE_ENV:'production'}).listaParaContratar,false);
    assert.equal(reglas.configuracion({...env,PAYPAL_SANDBOX_PLAN_ID:'PLAN-OTRO'}).listaParaContratar,false);
});
test('CSRF ligado a usuario y sesión, vencimiento y alteraciones',()=>{
    const c=reglas.configuracion(env), ahora=Date.now(), token=reglas.csrf(c,'sesion',1,ahora);
    assert.equal(reglas.validarCsrf(c,token,'sesion',1,ahora),true);
    assert.equal(reglas.validarCsrf(c,token,'otra',1,ahora),false);
    assert.equal(reglas.validarCsrf(c,token,'sesion',2,ahora),false);
    assert.equal(reglas.validarCsrf(c,token,'sesion',1,ahora+1801000),false);
});
test('el plan valida precio, producto, moneda, frecuencia y ausencia de cargos extra',()=>{
    const f=fixtures(); assert.equal(reglas.validarPlan(f.plan),true);
    for(const mutar of [p=>p.product_id='OTRO',p=>p.billing_cycles[0].pricing_scheme.fixed_price.value='2.00',
        p=>p.billing_cycles[0].frequency.interval_unit='YEAR',p=>p.payment_preferences.setup_fee.value='1.00',p=>p.quantity_supported=true]){
        const p=structuredClone(f.plan);mutar(p);assert.throws(()=>reglas.validarPlan(p));
    }
});
test('ACTIVE sin cobro no aporta cobertura',()=>{
    const f=fixtures(); assert.deepEqual(reglas.evaluarCobros(f.remota,[],new Map()),[]);
    assert.equal(reglas.coberturaVigente([]),null);
});
test('cobro válido tiene un periodo mensual; rechaza moneda, importe y vínculo ajeno',()=>{
    const f=fixtures(), c=snapshot(f).cobros[0]; assert.equal(c.estado,'COMPLETED');assert.ok(c.desde&&c.hasta);
    for(const mutar of [v=>v.billing_agreement_id='I-AJENA',v=>v.amount.currency='CLP',v=>v.amount.total='2.00']) {
        const venta=structuredClone(f.venta);mutar(venta);assert.throws(()=>reglas.evaluarCobros(f.remota,[f.t],new Map([[f.t.id,venta]])));
    }
});
test('datos de ciclo inconsistentes no conceden un periodo inventado',()=>{
    const f=fixtures(); f.remota.billing_info.next_billing_time=new Date(Date.now()+90*86400000).toISOString();
    assert.throws(()=>snapshot(f),{code:'PAYPAL_COBERTURA_NO_VERIFICADA'});
});
test('el horario del próximo cobro PayPal prevalece sobre la hora del inicio',()=>{
    const f=fixtures();const proxima=new Date(f.remota.billing_info.next_billing_time);proxima.setUTCHours(10);
    f.remota.billing_info.next_billing_time=proxima.toISOString();
    assert.equal(snapshot(f).cobros[0].hasta,proxima.toISOString());
    delete f.remota.billing_info.next_billing_time;
    assert.equal(snapshot(f).cobros[0].hasta,null);
});
test('fechas UTC y hora Chile consideran horario de verano e invierno',()=>{
    assert.equal(reglas.horaChile('2026-11-04T03:00:00Z'),'2026-11-04 00:00:00');
    assert.equal(reglas.horaChile('2026-07-04T04:00:00Z'),'2026-07-04 00:00:00');
    assert.throws(()=>reglas.instante('2026-11-04 03:00:00'));
});
test('el cálculo de cobertura no puentea periodos sin pagar',()=>{
    const cobros=[{estado:'COMPLETED',desde:'2026-01-01T00:00:00Z',hasta:'2026-02-01T00:00:00Z'},
        {estado:'COMPLETED',desde:'2026-03-01T00:00:00Z',hasta:'2026-04-01T00:00:00Z'}];
    assert.equal(reglas.coberturaVigente(cobros,new Date('2026-02-15T00:00:00Z')),null);
    assert.equal(reglas.coberturaVigente(cobros,new Date('2026-01-15T00:00:00Z')).hasta.toISOString(),'2026-02-01T00:00:00.000Z');
});
test('persistencia atómica: un cobro confirmado activa sin duplicar pagos ni contratos',async()=>{
    const e=memoria(), snap=snapshot(e.f);
    assert.equal((await e.modelo.sincronizar(e.f.local,snap)).activa,true);assert.equal(e.masterchef(),true);
    await e.modelo.sincronizar(e.f.local,snap);
    assert.equal(e.estado.cobros.length,1);assert.equal(e.estado.contratos.length,1);
    assert.ok(e.estado.sentencias.every(s=>!s.includes('alergia')&&!s.includes('intolerancia')&&!s.includes('INSERT INTO pago ')));
});
test('fallo de persistencia revierte cobro, contrato y plan',async()=>{
    const e=memoria();e.estado.fallarCobro=true;
    await assert.rejects(e.modelo.sincronizar(e.f.local,snapshot(e.f)),/Fallo de escritura/);
    assert.equal(e.estado.cobros.length,0);assert.equal(e.estado.contratos.length,0);assert.equal(e.estado.usuario.id_suscripcion,1);
});
test('reconciliación repara un plan Gratis con cobro y contrato existentes sin duplicarlos',async()=>{
    const e=memoria(), s=snapshot(e.f);
    assert.equal(e.estado.usuario.id_suscripcion,1);
    await e.modelo.sincronizar(e.f.local,s);
    const idContrato=e.estado.contratos[0].id_suscripcion_usuario;
    const idCobro=e.estado.cobros[0].id_paypal_cobro;
    // Simular únicamente en memoria la inconsistencia comunicada por el usuario.
    e.estado.usuario.id_suscripcion=1;
    assert.equal(e.masterchef(),false);
    await e.modelo.sincronizar(e.f.local,s);
    assert.equal(e.estado.usuario.id_suscripcion,2);assert.equal(e.masterchef(),true);
    assert.equal(e.estado.contratos.length,1);assert.equal(e.estado.contratos[0].id_suscripcion_usuario,idContrato);
    assert.equal(e.estado.cobros.length,1);assert.equal(e.estado.cobros[0].id_paypal_cobro,idCobro);
    await e.modelo.sincronizar(e.f.local,s);
    assert.equal(e.estado.contratos.length,1);assert.equal(e.estado.cobros.length,1);
});
test('si el plan del usuario no se actualiza, todo el lote de activación hace rollback',async()=>{
    const e=memoria();e.estado.fallarActualizacionUsuario=true;
    await assert.rejects(e.modelo.sincronizar(e.f.local,snapshot(e.f)),{code:'PAYPAL_PLAN_NO_ACTUALIZADO'});
    assert.equal(e.estado.usuario.id_suscripcion,1);assert.equal(e.estado.contratos.length,0);assert.equal(e.estado.cobros.length,0);
    assert.equal(e.estado.operaciones[0].id_suscripcion_usuario,undefined);
});
test('el perfil muestra el plan efectivo consultado por el servidor',async()=>{
    const ejs=require('ejs');
    for(const masterchef of [false,true]) {
        const nombre=masterchef?'MasterChef':'Gratis';
        const html=await ejs.renderFile(path.resolve(__dirname,'../views/perfil.ejs'),{planActual:{masterchef,nombre,codigo:masterchef?'masterchef':'gratis'},user:{},success:[],error:[]});
        assert.ok(html.includes(`Plan actual: <strong>${nombre}</strong>`));
    }
});
test('cancelación conserva periodo pagado; al terminar ya no hay beneficios PayPal',async()=>{
    const e=memoria(), s=snapshot(e.f);await e.modelo.sincronizar(e.f.local,s);
    s.remota.status='CANCELLED';delete s.remota.billing_info.next_billing_time;
    assert.equal((await e.modelo.sincronizar(e.f.local,s)).activa,true);
    e.estado.ahora=new Date(+reglas.instante(s.cobros[0].hasta)+1000);
    assert.equal((await e.modelo.sincronizar(e.f.local,s)).activa,false);assert.equal(e.masterchef(),false);
});
test('pago fallido no crea ni amplía cobertura',async()=>{
    const e=memoria(), s=snapshot(e.f);s.cobros=[];
    assert.equal((await e.modelo.sincronizar(e.f.local,s)).activa,false);
    assert.equal(e.estado.contratos.length,0);assert.equal(e.estado.usuario.id_suscripcion,1);
});
test('renovación confirmada añade otro cobro y amplía solo el contrato PayPal',async()=>{
    const e=memoria(), s=snapshot(e.f);await e.modelo.sincronizar(e.f.local,s);
    const siguiente=new Date(s.cobros[0].hasta), hasta=new Date(siguiente);hasta.setUTCMonth(hasta.getUTCMonth()+1);
    e.estado.ahora=new Date(+siguiente+1000);
    const renovacion={remota:{...s.remota,update_time:siguiente.toISOString()},cobros:[{...s.cobros[0],id:'VENTA-2',desde:siguiente.toISOString(),hasta:hasta.toISOString(),ocurrido:siguiente.toISOString()}]};
    const r=await e.modelo.sincronizar(e.f.local,renovacion);assert.equal(r.hasta,hasta.toISOString());assert.equal(e.estado.cobros.length,2);assert.equal(e.estado.contratos.length,1);
});
for(const origen of ['administrativo','legado']) test(`reembolso PayPal conserva contrato ${origen} independiente`,async()=>{
    const e=memoria(), inicio=reglas.horaChile(e.estado.ahora), manual={id_suscripcion_usuario:3,id_usuario:1,id_suscripcion:2,origen,estado:'activa',fecha_inicio:inicio,fecha_fin:null};
    e.estado.contratos.push(structuredClone(manual));e.estado.usuario.id_suscripcion=2;
    const s=snapshot(e.f);await e.modelo.sincronizar(e.f.local,s);s.cobros[0].estado='REFUNDED';s.cobros[0].desde=null;s.cobros[0].hasta=null;
    assert.equal((await e.modelo.sincronizar(e.f.local,s)).activa,false);
    assert.equal(e.masterchef(),true);assert.deepEqual(e.estado.contratos.find(c=>c.id_suscripcion_usuario===3),manual);
});
test('reversión invalida solo su cobro; consulta antigua no lo reactiva',async()=>{
    const e=memoria(), s=snapshot(e.f);await e.modelo.sincronizar(e.f.local,s);
    const reversa=structuredClone(s);reversa.cobros[0].estado='REVERSED';reversa.cobros[0].desde=null;reversa.cobros[0].hasta=null;
    await e.modelo.sincronizar(e.f.local,reversa);assert.equal(e.masterchef(),false);
    await e.modelo.sincronizar(e.f.local,s);assert.equal(e.masterchef(),false);assert.equal(e.estado.cobros[0].estado,'REVERSED');
});
test('reembolso parcial conserva cobertura establecida, nunca concede una nueva',async()=>{
    const e=memoria(), s=snapshot(e.f);await e.modelo.sincronizar(e.f.local,s);
    s.cobros[0].estado='PARTIAL_REVIEW';s.cobros[0].desde=null;s.cobros[0].hasta=null;
    assert.equal((await e.modelo.sincronizar(e.f.local,s)).revision,true);assert.equal(e.masterchef(),true);
    const nuevo=memoria();await nuevo.modelo.sincronizar(nuevo.f.local,{remota:nuevo.f.remota,cobros:s.cobros});assert.equal(nuevo.masterchef(),false);
});
test('un contrato local administrativo nunca se sobrescribe aunque una asociación esté corrupta',async()=>{
    const e=memoria();e.estado.operaciones[0].id_suscripcion_usuario=3;
    e.estado.contratos.push({id_suscripcion_usuario:3,id_usuario:1,id_suscripcion:2,origen:'administrativo',estado:'activa',fecha_inicio:'2020-01-01 00:00:00',fecha_fin:null});
    const copia=structuredClone(e.estado.contratos);
    await assert.rejects(e.modelo.sincronizar(e.f.local,snapshot(e.f)),{code:'PAYPAL_CONTRATO_NO_PROPIO'});assert.deepEqual(e.estado.contratos,copia);assert.equal(e.estado.cobros.length,0);
});
test('doble clic reutiliza operación; dos peticiones concurrentes no crean dos filas',async()=>{
    const e=memoria();e.estado.operaciones=[];
    const [a,b]=await Promise.all([e.modelo.iniciar(1,randomUUID()),e.modelo.iniciar(1,randomUUID())]);
    assert.equal(a.clave_operacion,b.clave_operacion);assert.equal(e.estado.operaciones.length,1);
});
test('cliente utiliza únicamente Sandbox; token y secreto nunca forman parte de errores públicos',async()=>{
    const f=fixtures(), llamadas=[];
    const cliente=reglas.crearCliente({env,fetchImpl:async(url,op)=>{
        llamadas.push({url,op});
        if(url.endsWith('/oauth2/token'))return{ok:true,json:async()=>({access_token:'token-falso',token_type:'Bearer',expires_in:3600})};
        return{ok:true,status:200,json:async()=>f.plan};
    }});
    await cliente.plan();await cliente.plan();assert.equal(llamadas.filter(l=>l.url.endsWith('/oauth2/token')).length,1);
    assert.ok(llamadas.every(l=>l.url.startsWith('https://api-m.sandbox.paypal.com/')));
    assert.ok(llamadas.every(l=>l.op.redirect==='error'));
    const malo=reglas.crearCliente({env,fetchImpl:async()=>({ok:false,status:401,json:async()=>({error:'invalid_client',secret:'dato-secreto'})})});
    await assert.rejects(malo.plan(),e=>e.code==='PAYPAL_AUTENTICACION_FALLIDA'&&!e.message.includes('dato-secreto'));
});
test('firma oficial: inválida no persiste ni activa; válida usa endpoint Sandbox',async()=>{
    let escrituras=0;
    const cliente={config:()=>reglas.configuracion(env),firma:async()=>{throw reglas.fallo('PAYPAL_FIRMA_INVALIDA',400);}};
    const c=controlador({cliente,db:{registrarEvento:async()=>{escrituras++;}}}),r=respuesta();
    await c.webhook({headers:{},body:{id:'WH-1',event_type:'PAYMENT.SALE.COMPLETED',resource:{id:'VENTA-1'}}},r);
    assert.equal(r.statusCode,400);assert.equal(escrituras,0);
    const rutas=[];
    const api=reglas.crearCliente({env,fetchImpl:async(url)=>{rutas.push(url);return{ok:true,status:200,json:async()=>url.endsWith('/token')?{access_token:'token-falso',token_type:'Bearer',expires_in:3600}:{verification_status:'SUCCESS'}};}});
    await api.firma({'paypal-auth-algo':'SHA256withRSA','paypal-cert-url':'https://api.sandbox.paypal.com/v1/notifications/certs/CERT',
        'paypal-transmission-id':'id','paypal-transmission-sig':'firma','paypal-transmission-time':new Date().toISOString()},{id:'WH-1'});
    assert.ok(rutas.includes('https://api-m.sandbox.paypal.com/v1/notifications/verify-webhook-signature'));
});
test('webhook duplicado no vuelve a sincronizar; recuperación utiliza registro duradero',async()=>{
    const f=fixtures(), evento={id:'WH-1',event_type:'BILLING.SUBSCRIPTION.ACTIVATED',resource:{id:f.remota.id}};
    let fila=null,procesada=false,sincronizaciones=0;
    const db={registrarEvento:async(e,h)=>{fila||={paypal_event_id:e.id,tipo:e.event_type,huella_contenido:h};},
        reclamarEvento:async()=>procesada?null:fila,buscarRemota:async()=>f.local,
        sincronizar:async()=>{sincronizaciones++;return{activa:false};},cerrarEvento:async(_f,e)=>{if(!e)procesada=true;}};
    const cliente={config:()=>reglas.configuracion(env),firma:async()=>{},evento:async()=>evento,verificar:async()=>snapshot(f)};
    const c=controlador({db,cliente});await c.webhook({headers:{},body:evento},respuesta());await c.webhook({headers:{},body:evento},respuesta());
    assert.equal(sincronizaciones,1);assert.equal(procesada,true);
});
test('retorno no confía en subscription_id del navegador ni concede acceso por ACTIVE',async()=>{
    const f=fixtures();let sincronizada=0;
    const db={buscarOperacion:async(clave,usuario)=>clave===f.local.clave_operacion&&usuario===1?f.local:null,sincronizar:async()=>{sincronizada++;return{activa:false};}};
    const cliente={config:()=>reglas.configuracion(env),verificar:async()=>({remota:f.remota,cobros:[]})};
    const c=controlador({db,cliente}),r=respuesta();
    await c.retorno({idUsuarioAutenticado:1,query:{operacion:f.local.clave_operacion,subscription_id:'I-AJENA'}},r);
    assert.equal(sincronizada,1);assert.ok(r.destino.startsWith('/suscripciones?paypal=retorno'));
    const ajena=respuesta();await c.estado({idUsuarioAutenticado:2,query:{operacion:f.local.clave_operacion}},ajena);assert.equal(ajena.statusCode,404);
});
test('salir de aprobación no cancela un contrato ni escribe datos',()=>{
    const c=controlador({db:{},cliente:{}}),r=respuesta();c.cancelado({},r);assert.equal(r.destino,'/suscripciones?paypal=cancelado');
});
test('no se pueden crear suscripciones sin CSRF/origen válidos ni con configuración incompleta',async()=>{
    let creaciones=0;const db={iniciar:async()=>{creaciones++;}};
    const cliente={config:()=>reglas.configuracion(env)};
    const c=controlador({db,cliente}),r=respuesta();await c.contratar({get:()=>'',sessionID:'sesion',idUsuarioAutenticado:1},r);
    assert.equal(r.statusCode,403);assert.equal(creaciones,0);
    const incompleto=controlador({db,cliente:{config:()=>reglas.configuracion({...env,PAYPAL_SANDBOX_WEBHOOK_ID:''})}}),s=respuesta();
    await incompleto.contratar({},s);assert.equal(s.statusCode,503);assert.equal(creaciones,0);
});
test('contratación usa identidad del servidor y reutiliza operación; aprobar no activa beneficios',async()=>{
    const f=fixtures(), cfig=reglas.configuracion(env);let creaciones=0,local={...f.local,paypal_subscription_id:null};
    const remota={...f.remota,status:'APPROVAL_PENDING',links:[{rel:'approve',href:'https://www.sandbox.paypal.com/webapps/billing/subscriptions?ba_token=FICTICIO'}]};
    const db={iniciar:async(id)=>{assert.equal(id,1);return local;},vincular:async()=>{local={...local,paypal_subscription_id:remota.id};return local;}};
    const cliente={config:()=>cfig,crear:async()=>{creaciones++;return{id:remota.id};},suscripcion:async()=>remota};
    const csrf=reglas.csrf(cfig,'sesion',1),clave=randomUUID();
    const req={sessionID:'sesion',idUsuarioAutenticado:1,body:{id_usuario:999,importe:'0.01'},get:h=>({origin:cfig.origen,'x-paypal-csrf':csrf,'Idempotency-Key':clave})[h]};
    const c=controlador({db,cliente}),r=respuesta();await c.contratar(req,r);assert.equal(r.body.ok,true);assert.match(r.body.aprobacion,/www.sandbox.paypal.com/);
    assert.equal(r.body.estado,'APPROVAL_PENDING');await c.contratar(req,respuesta());assert.equal(creaciones,1);
});
test('recuperación reintenta operaciones ambiguas con la misma clave, sin crear otra operación local',async()=>{
    const f=fixtures();let vinculadas=0;
    const c=controlador({db:{eventosPendientes:async()=>[],contratosPendientes:async()=>[{...f.local,paypal_subscription_id:null}],vincular:async()=>{vinculadas++;}},
        cliente:{config:()=>reglas.configuracion(env),crear:async(local)=>{assert.equal(local.clave_operacion,f.local.clave_operacion);return{id:f.remota.id};},suscripcion:async()=>f.remota}});
    await c.recuperar();assert.equal(vinculadas,1);
});
test('la vista conserva CLP y distingue el importe ficticio; ningún secreto se entrega al navegador',async()=>{
    const ejs=require('ejs');
    const html=await ejs.renderFile(path.resolve(__dirname,'../views/suscripciones.ejs'),{planActual:{masterchef:false,codigo:'gratis',nombre:'Gratis'},avisosSuscripcion:[]});
    assert.match(html,/7\.990/);assert.match(html,/USD \$1\.00 mensual ficticio/);assert.match(html,/\/Js\/paypal.js/);
    assert.doesNotMatch(html,/CLIENT_SECRET|access_token/);
});

test('solo localhost:3000 Sandbox admite HTTP y webhook opcional; otros destinos lo rechazan',()=>{
    const local={...env,PAYPAL_SANDBOX_BASE_URL:'http://localhost:3000',PAYPAL_SANDBOX_WEBHOOK_ID:''};
    assert.equal(reglas.configuracion(local).listaParaContratar,true);
    assert.equal(reglas.configuracion(local).modoLocal,true);
    for(const destino of ['http://example.com','http://localhost:4000','http://localhost.example:3000',
        'http://localhost:3000/?x=1','http://usuario@localhost:3000','http://127.0.0.1:3000']) {
        assert.equal(reglas.configuracion({...local,PAYPAL_SANDBOX_BASE_URL:destino}).listaParaContratar,false,destino);
    }
    assert.equal(reglas.configuracion({...local,PAYPAL_SANDBOX_BASE_URL:'https://cookiq.example'}).listaParaContratar,false);
});
test('creación simulada envía retorno local y cancelación local exclusivamente a la API Sandbox',async()=>{
    const f=fixtures(), peticiones=[];
    const cliente=reglas.crearCliente({env:{...env,PAYPAL_SANDBOX_BASE_URL:'http://localhost:3000',PAYPAL_SANDBOX_WEBHOOK_ID:''},fetchImpl:async(url,op)=>{
        peticiones.push({url,op});
        return{ok:true,status:200,json:async()=>url.endsWith('/token')?{access_token:'ficticio',token_type:'Bearer',expires_in:3600}:
            url.includes('/plans/')?f.plan:{id:f.remota.id}};
    }});
    await cliente.crear(f.local);
    const p=peticiones.find(p=>p.op.method==='POST'&&p.url.endsWith('/billing/subscriptions'));
    const cuerpo=JSON.parse(p.op.body);
    assert.equal(cuerpo.application_context.return_url,`http://localhost:3000/api/paypal/retorno?operacion=${f.local.clave_operacion}`);
    assert.equal(cuerpo.application_context.cancel_url,`http://localhost:3000/api/paypal/cancelado?operacion=${f.local.clave_operacion}`);
    assert.equal(p.op.headers['PayPal-Request-Id'],f.local.clave_operacion);
    assert.ok(peticiones.every(p=>p.url.startsWith('https://api-m.sandbox.paypal.com/')));
});
test('reconciliación local sin webhook funciona sin retorno y agrupa verificaciones concurrentes',async()=>{
    const f=fixtures(), config=reglas.configuracion({...env,PAYPAL_SANDBOX_BASE_URL:'http://localhost:3000',PAYPAL_SANDBOX_WEBHOOK_ID:''});
    let lecturas=0,guardados=0;
    const db={eventosPendientes:async()=>assert.fail('No se requiere webhook en modo local'),
        contratosPendientes:async()=>[f.local],sincronizar:async()=>{guardados++;return{activa:false};},buscarOperacion:async()=>f.local};
    const cliente={config:()=>config,verificar:async()=>{lecturas++;await new Promise(r=>setImmediate(r));return{remota:f.remota,cobros:[]};}};
    const c=controlador({db,cliente,planUsuario:async()=>({masterchef:false})});
    const req={idUsuarioAutenticado:1,query:{operacion:f.local.clave_operacion}};
    await Promise.all([c.recuperar(),c.estado(req,respuesta())]);
    await c.estado(req,respuesta());
    assert.equal(lecturas,1);assert.equal(guardados,1);
});
test('fallo de PayPal local no activa y aplica espera antes de consultar otra vez',async()=>{
    const f=fixtures();let intentos=0,escrituras=0;
    const c=controlador({db:{buscarOperacion:async()=>f.local,sincronizar:async()=>{escrituras++;}},
        cliente:{config:()=>reglas.configuracion({...env,PAYPAL_SANDBOX_BASE_URL:'http://localhost:3000',PAYPAL_SANDBOX_WEBHOOK_ID:''}),
            verificar:async()=>{intentos++;throw reglas.fallo('PAYPAL_NO_DISPONIBLE',503);}}});
    const req={idUsuarioAutenticado:1,query:{operacion:f.local.clave_operacion}},a=respuesta(),b=respuesta();
    await c.estado(req,a);await c.estado(req,b);
    assert.equal(a.statusCode,200);assert.equal(b.statusCode,200);assert.equal(b.body.pendienteActivacion,true);
    assert.equal(b.body.estadoVerificacion,'error_temporal');assert.equal(intentos,1);assert.equal(escrituras,0);
});
test('modo local no acepta webhooks sin verificar firma aunque permita contratar',async()=>{
    const cliente=reglas.crearCliente({env:{...env,PAYPAL_SANDBOX_BASE_URL:'http://localhost:3000',PAYPAL_SANDBOX_WEBHOOK_ID:''},
        fetchImpl:async()=>assert.fail('Sin Webhook ID no se consulta una firma')});
    await assert.rejects(cliente.firma({},{}),{code:'PAYPAL_CONFIGURACION_PENDIENTE'});
});

test('retorno responde antes de PayPal y una contratación pendiente se activa después sin otra compra',async()=>{
    const m=memoria(); let ahora=Date.now(),lecturas=0,liberar;
    const db={...m.modelo,eventosPendientes:async()=>[],contratosPendientes:async()=>[await m.modelo.buscarOperacion(m.f.local.clave_operacion,1)]};
    const cliente={config:()=>reglas.configuracion({...env,PAYPAL_SANDBOX_BASE_URL:'http://localhost:3000',PAYPAL_SANDBOX_WEBHOOK_ID:''}),
        verificar:async()=>{lecturas++;if(lecturas===1) return new Promise(r=>{liberar=()=>r({remota:m.f.remota,cobros:[]});});
            return snapshot(m.f);},crear:async()=>assert.fail('No crear otra suscripción')};
    const deps={db,cliente,reloj:()=>ahora,planUsuario:async()=>({masterchef:m.masterchef()})};
    const c=controlador(deps),req={idUsuarioAutenticado:1,query:{operacion:m.f.local.clave_operacion}},r=respuesta();
    await c.retorno(req,r);assert.match(r.destino,/paypal=retorno/);assert.equal(m.estado.cobros.length,0);
    const pendiente=respuesta();await c.estado(req,pendiente);assert.equal(pendiente.body.pendienteActivacion,true);
    liberar();await new Promise(r=>setImmediate(r));assert.equal(m.masterchef(),false);
    ahora+=21000;m.estado.ahora=new Date(ahora);
    // Sin navegador: el trabajador recupera la operación persistida.
    await c.recuperar();assert.equal(m.masterchef(),true);assert.equal(lecturas,2);
    await c.recuperar();assert.equal(m.estado.cobros.length,1);assert.equal(m.estado.contratos.length,1);
    const activa=respuesta();await c.estado(req,activa);assert.equal(activa.body.masterchef,true);
});

test('reinicio recupera una operación pendiente y no duplica una activación ya confirmada',async()=>{
    const m=memoria();let consultas=0;
    const db={...m.modelo,contratosPendientes:async()=>[await m.modelo.buscarOperacion(m.f.local.clave_operacion,1)]};
    const cliente={config:()=>reglas.configuracion({...env,PAYPAL_SANDBOX_BASE_URL:'http://localhost:3000',PAYPAL_SANDBOX_WEBHOOK_ID:''}),
        verificar:async()=>{consultas++;return consultas===1?{remota:m.f.remota,cobros:[]}:snapshot(m.f);}};
    await controlador({db,cliente}).recuperar();assert.equal(m.masterchef(),false);
    await controlador({db,cliente}).recuperar();assert.equal(m.masterchef(),true);
    await controlador({db,cliente}).recuperar();assert.equal(m.estado.cobros.length,1);assert.equal(m.estado.contratos.length,1);
});

test('fallos temporales reintentan con espera progresiva sin conceder beneficios',async()=>{
    const f=fixtures();let ahora=Date.now(),intentos=0,guardados=0;
    const c=controlador({reloj:()=>ahora,db:{contratosPendientes:async()=>[f.local],
        sincronizar:async()=>{guardados++;return{activa:true};}},cliente:{config:()=>reglas.configuracion({...env,
        PAYPAL_SANDBOX_BASE_URL:'http://localhost:3000',PAYPAL_SANDBOX_WEBHOOK_ID:''}),verificar:async()=>{
            intentos++;if(intentos<3)throw reglas.fallo('PAYPAL_NO_DISPONIBLE',503);return snapshot(f);}}});
    await c.recuperar();assert.equal(intentos,1);assert.equal(guardados,0);
    ahora+=29000;await c.recuperar();assert.equal(intentos,1);
    ahora+=1001;await c.recuperar();assert.equal(intentos,2);assert.equal(guardados,0);
    ahora+=59000;await c.recuperar();assert.equal(intentos,2);
    ahora+=1001;await c.recuperar();assert.equal(intentos,3);assert.equal(guardados,1);
});

test('consulta de recuperación parametriza exclusiones y mantiene agrupación SQL equilibrada',async()=>{
    let consulta,parametros;
    const m=cargar('models/paypalModel.js',{'../config/db':{execute:async(q,p)=>{consulta=q;parametros=p;return[[]];}}});
    await m.contratosPendientes(['I-PRUEBA',"invalido' OR 1=1"]);
    assert.deepEqual(parametros,['I-PRUEBA']);assert.match(consulta,/NOT IN \(\?\)/);
    let balance=0;for(const c of consulta){if(c==='(')balance++;if(c===')')balance--;assert.ok(balance>=0);}assert.equal(balance,0);
    assert.match(consulta,/INTERVAL 5 SECOND/);
});
test('interfaz local habilita el botón sin ngrok y redirige solo al checkout Sandbox simulado',async()=>{
    const elementos={};
    for(const id of ['contratarPayPal','avisoSuscripcion','verificarPayPal','cancelarPayPal']) elementos[id]={disabled:true,hidden:false,
        listeners:{},addEventListener(tipo,fn){this.listeners[tipo]=fn;},setAttribute(){}};
    let destino=null;
    const configuracion={ok:true,preparado:true,modoLocal:true,masterchef:false,origen:'http://localhost:3000',
        csrf:'token-ficticio',mensaje:'Sandbox local sin webhook',operacion:null,estado:null};
    const peticiones=[];
    const contexto={document:{getElementById:id=>elementos[id]},location:new URL('http://localhost:3000/suscripciones'),URL,URLSearchParams,
        crypto:{randomUUID},setTimeout,clearTimeout,window:{addEventListener(){},location:{assign:url=>{destino=url;}}},fetch:async(url,op)=>{
            peticiones.push({url,op});return{ok:true,json:async()=>url.endsWith('/configuracion')?configuracion:
                {ok:true,operacion:randomUUID(),aprobacion:'https://www.sandbox.paypal.com/webapps/billing/subscriptions?ba_token=FICTICIO'}};
        }};
    vm.runInNewContext(fs.readFileSync(path.resolve(__dirname,'../public/Js/paypal.js'),'utf8'),contexto);
    await new Promise(r=>setImmediate(r));
    assert.equal(elementos.contratarPayPal.disabled,false);
    await elementos.contratarPayPal.listeners.click();
    assert.ok(destino.startsWith('https://www.sandbox.paypal.com/'));
    assert.equal(peticiones.filter(p=>p.url.endsWith('/suscripciones')).length,1);
});

test('interfaz reanuda contratación pendiente al abrir la página y actualiza permisos al confirmarse',async()=>{
    const elementos={};for(const id of ['contratarPayPal','avisoSuscripcion','verificarPayPal','cancelarPayPal'])
        elementos[id]={addEventListener(){},setAttribute(){}};
    let destino,programada,consultas=0;
    const configuracion={ok:true,preparado:true,masterchef:false,pendienteActivacion:true,operacion:randomUUID(),
        origen:'http://localhost:3000',estado:'APPROVAL_PENDING'};
    vm.runInNewContext(fs.readFileSync(path.resolve(__dirname,'../public/Js/paypal.js'),'utf8'),{
        document:{getElementById:id=>elementos[id]},location:new URL('http://localhost:3000/suscripciones'),URL,URLSearchParams,
        setTimeout:(fn,ms)=>{programada=fn;assert.equal(ms,20000);return 1;},clearTimeout(){},
        window:{addEventListener(){},location:{assign:url=>{destino=url;}}},fetch:async url=>({ok:true,json:async()=>{
            if(url.endsWith('/configuracion'))return configuracion;
            consultas++;return{ok:true,masterchef:consultas>1,pendienteActivacion:consultas===1,
                reintentarEnSegundos:20,estado:'ACTIVE',mensaje:consultas===1?'Verificando':'Disponible'};
        }})});
    await new Promise(r=>setImmediate(r));assert.equal(consultas,1);assert.equal(destino,undefined);
    await programada();assert.equal(consultas,2);assert.equal(destino,'/suscripciones?paypal=activado');
});

test('comprobante de aviso solo sirve para su usuario, operación y periodo de compra',()=>{
    const f=fixtures(),c=reglas.configuracion(env),ahora=Date.now(),token=reglas.comprobanteAviso(c,f.local,ahora);
    assert.equal(reglas.validarComprobanteAviso(c,f.local,token,ahora),true);
    assert.equal(reglas.validarComprobanteAviso(c,{...f.local,id_usuario:2},token,ahora),false);
    assert.equal(reglas.validarComprobanteAviso(c,{...f.local,clave_operacion:randomUUID()},token,ahora),false);
    assert.equal(reglas.validarComprobanteAviso(c,f.local,token,ahora+8*86400000),false);
    assert.equal(reglas.validarComprobanteAviso(c,f.local,'alterado',ahora),false);
});

test('aviso persistente exige pago y contrato vigentes y se reclama una vez incluso tras renovar',async()=>{
    const m=memoria();assert.equal(await m.modelo.reclamarAvisoCompra(m.f.local),false);
    await m.modelo.sincronizar(m.f.local,snapshot(m.f));
    assert.equal(await m.modelo.reclamarAvisoCompra(m.f.local),true);
    assert.equal(await m.modelo.reclamarAvisoCompra(m.f.local),false);
    await m.modelo.sincronizar(m.f.local,snapshot(m.f));
    assert.equal(await m.modelo.reclamarAvisoCompra(m.f.local),false);
    assert.equal(await m.modelo.reclamarAvisoCompra({...m.f.local,id_usuario:2}),false);
    assert.equal(m.estado.cobros.length,1);assert.equal(m.estado.contratos.length,1);
});

test('no se reclama éxito para pendientes, canceladas sin cobertura ni derechos administrativos',async()=>{
    const m=memoria();
    await m.modelo.sincronizar(m.f.local,{remota:m.f.remota,cobros:[]});
    assert.equal(await m.modelo.reclamarAvisoCompra(m.f.local),false);
    await m.modelo.sincronizar(m.f.local,{remota:{...m.f.remota,status:'CANCELLED'},cobros:[]});
    assert.equal(await m.modelo.reclamarAvisoCompra(m.f.local),false);
    m.estado.usuario.id_suscripcion=2;
    m.estado.contratos.push({id_suscripcion_usuario:33,id_usuario:1,id_suscripcion:2,origen:'administrativo',
        estado:'activa',fecha_inicio:'2000-01-01 00:00:00',fecha_fin:null});
    m.estado.operaciones[0].id_suscripcion_usuario=33;
    assert.equal(await m.modelo.reclamarAvisoCompra(m.f.local),false);
});

test('flash usa el sistema existente y no se repite después de reiniciar el controlador',async()=>{
    const m=memoria(),cfig=reglas.configuracion(env),ahora=Date.now(),flashes=[];
    await m.modelo.sincronizar(m.f.local,snapshot(m.f));
    const req={idUsuarioAutenticado:1,sessionID:'sesion',session:{save:fn=>fn()},flash:(tipo,texto)=>flashes.push({tipo,texto}),
        body:{operacion:m.f.local.clave_operacion,comprobanteAviso:reglas.comprobanteAviso(cfig,m.f.local,ahora)},
        get:h=>({origin:cfig.origen,'x-paypal-csrf':reglas.csrf(cfig,'sesion',1)})[h]};
    const deps={db:m.modelo,cliente:{config:()=>cfig},reloj:()=>ahora};
    const a=respuesta();await controlador(deps).notificarCompra(req,a);assert.equal(a.body.notificada,true);
    const b=respuesta();await controlador(deps).notificarCompra(req,b);assert.equal(b.body.notificada,false);
    assert.equal(flashes.length,1);assert.equal(flashes[0].tipo,'success');assert.match(flashes[0].texto,/¡Compra realizada con éxito! 🎉/);
    assert.equal(m.estado.cobros.length,1);assert.equal(m.estado.contratos.length,1);
});

test('flash no se emite con comprobante ajeno ni antes del cobro',async()=>{
    const m=memoria(),cfig=reglas.configuracion(env),ahora=Date.now();let flashes=0;
    const req={idUsuarioAutenticado:1,sessionID:'sesion',session:{save:fn=>fn()},flash:()=>flashes++,
        body:{operacion:m.f.local.clave_operacion,comprobanteAviso:reglas.comprobanteAviso(cfig,{...m.f.local,id_usuario:2},ahora)},
        get:h=>({origin:cfig.origen,'x-paypal-csrf':reglas.csrf(cfig,'sesion',1)})[h]};
    const c=controlador({db:m.modelo,cliente:{config:()=>cfig},reloj:()=>ahora}),a=respuesta();
    await c.notificarCompra(req,a);assert.equal(a.statusCode,403);
    req.body.comprobanteAviso=reglas.comprobanteAviso(cfig,m.f.local,ahora);
    const b=respuesta();await c.notificarCompra(req,b);assert.equal(b.body.notificada,false);assert.equal(flashes,0);
});

test('reintentos pendientes usan 5,10,20,30,60 segundos y el retorno no duplica consultas',async()=>{
    const f=fixtures();let ahora=Date.now(),lecturas=0;
    const c=controlador({reloj:()=>ahora,db:{buscarOperacion:async()=>f.local,contratosPendientes:async()=>[f.local],
        sincronizar:async()=>({activa:false})},cliente:{config:()=>reglas.configuracion({...env,
            PAYPAL_SANDBOX_BASE_URL:'http://localhost:3000',PAYPAL_SANDBOX_WEBHOOK_ID:''}),
        verificar:async()=>{lecturas++;return{remota:f.remota,cobros:[]};}}});
    const req={idUsuarioAutenticado:1,query:{operacion:f.local.clave_operacion}};
    await c.retorno(req,respuesta());await new Promise(r=>setImmediate(r));
    for(const segundos of [5,10,20,30,60]) {
        const r=respuesta();await c.estado(req,r);assert.equal(r.body.reintentarEnSegundos,segundos);
        const antes=lecturas;await c.retorno(req,respuesta());assert.equal(lecturas,antes);
        ahora+=segundos*1000+1;await c.recuperar();
    }
    assert.equal(lecturas,6);
});

test('la vista muestra flash escapado con el componente y estilos existentes',async()=>{
    const ejs=require('ejs');const html=await ejs.renderFile(path.resolve(__dirname,'../views/suscripciones.ejs'),{
        planActual:{masterchef:true,nombre:'MasterChef'},avisosSuscripcion:[],success:['¡Compra realizada con éxito! <script>']});
    assert.match(html,/id="mensajeFlashCookIQ"/);assert.match(html,/&lt;script&gt;/);assert.match(html,/\/Js\/app.js/);
    const app=fs.readFileSync(path.resolve(__dirname,'../public/Js/app.js'),'utf8');
    assert.match(app,/if \(mensaje\) mostrarAvisoFavoritos\(mensaje\)/);
});

test('navegador solicita el flash solo tras confirmación y elimina el comprobante antes de recargar',async()=>{
    const op=randomUUID(),almacen=new Map([[`cookiq:paypal:aviso:${op}`,'comprobante-ficticio']]),elementos={};
    for(const id of ['contratarPayPal','avisoSuscripcion','verificarPayPal','cancelarPayPal'])elementos[id]={addEventListener(){},setAttribute(){}};
    let destino,consultas=0,programada;const avisos=[];
    vm.runInNewContext(fs.readFileSync(path.resolve(__dirname,'../public/Js/paypal.js'),'utf8'),{
        document:{getElementById:id=>elementos[id]},location:new URL('http://localhost:3000/suscripciones?paypal=retorno'),URL,URLSearchParams,
        console:{info(){}},setTimeout:fn=>{programada=fn;},clearTimeout(){},
        sessionStorage:{getItem:k=>almacen.get(k),setItem:(k,v)=>almacen.set(k,v),removeItem:k=>almacen.delete(k)},
        window:{addEventListener(){},location:{assign:url=>destino=url}},fetch:async(url,opciones)=>({ok:true,json:async()=>{
            if(url.endsWith('/configuracion'))return{ok:true,preparado:true,origen:'http://localhost:3000',masterchef:false,
                operacion:op,csrf:'csrf-ficticio',pendienteActivacion:true};
            if(url.includes('/estado?')){consultas++;return{ok:true,masterchef:consultas>1,pendienteActivacion:consultas===1,reintentarEnSegundos:5,
                estado:'ACTIVE',mensaje:'Verificando'};}
            assert.ok(url.endsWith('/notificacion-compra'));assert.equal(consultas,2);
            assert.equal(opciones.method,'POST');assert.equal(JSON.parse(opciones.body).operacion,op);avisos.push(url);
            return{ok:true,notificada:true};
        }})});
    await new Promise(r=>setImmediate(r));assert.equal(avisos.length,0);assert.equal(destino,undefined);
    await programada();assert.equal(avisos.length,1);assert.equal(almacen.size,0);assert.equal(destino,'/suscripciones?paypal=activado');
});
