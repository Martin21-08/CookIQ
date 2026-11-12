// Pruebas aisladas: no cargan config/db, Firebase ni el cliente de OpenAI.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const { createRequire } = require('node:module');
const { EventEmitter } = require('node:events');
const { randomUUID, createHash } = require('node:crypto');
const reglas = require('../services/solicitudesService');

function cargar(archivo, dependencias) {
    const nombre = path.resolve(__dirname, '..', archivo);
    const modulo = { exports: {} };
    const real = createRequire(nombre);
    const requireAislado = id => {
        if (Object.hasOwn(dependencias, id)) return dependencias[id];
        if (/config\/db|openai|firebase/i.test(id)) throw new Error(`Dependencia real prohibida: ${id}`);
        return real(id);
    };
    vm.runInThisContext(`(function(require,module,exports){${fs.readFileSync(nombre,'utf8')}\n})`, { filename: nombre })(requireAislado, modulo, modulo.exports);
    return modulo.exports;
}
function entorno() {
    const estado = { solicitudes: [], recetas: [], vinculos: [], pasos: [], ahora: new Date('2026-11-03T15:00:00Z'),
        plan: { id_suscripcion: 1, codigo: 'gratis', masterchef: false, solicitudes_diarias: 5 }, falloVinculo: false };
    let cola = Promise.resolve();
    const ejecutar = async (sql, p = []) => {
        const q = sql.replace(/\s+/g,' ').trim();
        if (q.startsWith('SET TRANSACTION')) return [{}];
        if (q.includes('GET_LOCK')) return [[{ adquirido: 1 }]];
        if (q.includes('RELEASE_LOCK')) return [[{ liberado: 1 }]];
        if (q.startsWith('SELECT DATE_FORMAT')) return [[{ ahora: estado.ahora.toISOString() }]];
        if (q.startsWith('SELECT *, ')) return [estado.solicitudes.filter(r => r.id_usuario === p[0] && r.clave_idempotencia === p[1])
            .map(r => ({ ...r, vigente: Number(r.vence_en > estado.ahora) }))];
        if (q.includes('COALESCE(SUM')) {
            const propias = estado.solicitudes.filter(r => r.id_usuario === p[3]);
            return [[{ exitosas: propias.filter(r => r.estado === 'exitosa' && r.sujeta_cuota && r.dia_consumo === p[0]).length,
                reservas: propias.filter(r => r.estado === 'reservada' && r.sujeta_cuota && r.vence_en > estado.ahora && r.id_solicitud !== p[1]).length,
                activas: propias.filter(r => r.estado === 'reservada' && r.vence_en > estado.ahora && r.id_solicitud !== p[2]).length,
                recientes: propias.filter(r => r.creada_en > new Date(+estado.ahora - 60000)).length }]];
        }
        if (q.startsWith('SELECT COUNT(*)')) return [[{ total: estado.solicitudes.filter(r => Buffer.from(r.ip_huella).equals(p[0]) && r.creada_en > new Date(+estado.ahora - 60000)).length }]];
        if (q.startsWith('INSERT INTO solicitud_generacion ')) {
            const id = estado.solicitudes.length + 1;
            estado.solicitudes.push({ id_solicitud: id, id_usuario:p[0], id_suscripcion:p[1], clave_idempotencia:p[2], huella_peticion:p[3], ip_huella:p[4],
                estado:'reservada', sujeta_cuota:p[5], dia_reserva:p[6], cantidad_recetas:0,
                creada_en:new Date(estado.ahora), vence_en:new Date(+estado.ahora + 180000) });
            return [{ insertId:id }];
        }
        if (q.startsWith('SELECT id_solicitud')) return [estado.solicitudes.filter(r => r.id_solicitud === p[0] && r.id_usuario === p[1]
            && r.estado === 'reservada' && r.vence_en > estado.ahora && +r.creada_en + 600000 > +estado.ahora)];
        if (q.startsWith('UPDATE solicitud_generacion SET estado = \'exitosa\'')) {
            const r = estado.solicitudes.find(r => r.id_solicitud === p[4] && r.id_usuario === p[5] && r.estado === 'reservada' && r.vence_en > estado.ahora);
            if (!r) return [{ affectedRows:0 }];
            Object.assign(r,{ estado:'exitosa', id_suscripcion:p[0], sujeta_cuota:p[1], dia_consumo:p[2], cantidad_recetas:p[3] });
            return [{ affectedRows:1 }];
        }
        if (q.startsWith('UPDATE solicitud_generacion SET estado = ?')) {
            const r = estado.solicitudes.find(r => r.id_solicitud === p[1] && r.id_usuario === p[2] && r.estado === 'reservada');
            if (r) r.estado = p[0];
            return [{ affectedRows:Number(Boolean(r)) }];
        }
        if (q.startsWith('UPDATE solicitud_generacion SET vence_en')) {
            const r = estado.solicitudes.find(r => r.id_solicitud === p[0] && r.id_usuario === p[1] && r.estado === 'reservada'
                && r.vence_en > estado.ahora && +r.creada_en + 600000 > +estado.ahora);
            if (r) r.vence_en = new Date(Math.min(+estado.ahora + 180000,+r.creada_en + 600000));
            return [{ affectedRows:Number(Boolean(r)) }];
        }
        if (q.startsWith('INSERT INTO solicitud_generacion_receta')) {
            if (estado.falloVinculo) throw new Error('Fallo simulado de relación');
            estado.vinculos.push([...p]); return [{ affectedRows:1 }];
        }
        if (q.startsWith('SELECT id_unidad')) return [[{ id_unidad:1,nombre:'gramo',abreviatura:'g',familia:'peso' }]];
        if (q.startsWith('SELECT id_dificultad')) return [[{ id_dificultad:1 }]];
        if (q.startsWith('INSERT INTO receta ')) {
            const id = estado.recetas.length + 101;
            estado.recetas.push({ idReceta:id, id_usuario:p[0], nombre:p[1] }); return [{ insertId:id }];
        }
        if (q.startsWith('INSERT INTO generacion_ia ')) return [{ insertId:1 }];
        if (q.startsWith('INSERT INTO receta_ingrediente') || q.startsWith('INSERT INTO generacion_ia_ingrediente')) return [{ affectedRows:1 }];
        if (q.startsWith('INSERT INTO paso_receta')) { estado.pasos.push(p); return [{ affectedRows:1 }]; }
        if (q.startsWith('SELECT r.id_receta AS idReceta')) {
            return [estado.recetas.filter(r => r.id_usuario === p[1] && estado.vinculos.some(v => v[0] === p[0] && v[1] === r.idReceta))];
        }
        if (q.startsWith('SELECT i.nombre, ri.cantidad')) return [[]];
        if (q.startsWith('SELECT descripcion FROM paso_receta')) return [estado.pasos.filter(paso => paso[0] === p[0]).map(paso => ({ descripcion:paso[2] }))];
        throw new Error(`SQL sin simular: ${q}`);
    };
    const pool = { execute:ejecutar, query:ejecutar, getConnection: async () => {
        let liberar, copia;
        return { execute:ejecutar, query:ejecutar,
            beginTransaction: async () => {
                const anterior = cola; cola = new Promise(r => { liberar = r; }); await anterior;
                copia = structuredClone({ solicitudes:estado.solicitudes, recetas:estado.recetas, vinculos:estado.vinculos, pasos:estado.pasos });
            }, commit:async () => liberar(), rollback:async () => { Object.assign(estado,copia); liberar(); }, release() {}, destroy() {} };
    } };
    const planes = { obtenerPlan:async () => ({ ...estado.plan }) };
    const modelo = cargar('models/solicitudGeneracionModel.js', { '../config/db':pool, './suscripcionModel':planes });
    const recetas = cargar('models/recetaModel.js', { '../config/db':pool, './solicitudGeneracionModel':modelo,
        './ingredienteModel':{ resolverOCrearIATransaccional:async()=>({ id_ingrediente:1 }) } });
    const datos = (ip = 'red') => ({ clave:randomUUID(), huella:createHash('sha256').update('consulta').digest(), ip:createHash('sha256').update(ip).digest() });
    const guardar = (id, cantidad = 1) => recetas.guardarGeneradas(Array.from({ length:cantidad }, (_, i) => ({ nombre:`Receta ${i}`, dificultad:'Fácil', minutosPreparacion:20, porciones:2, ingredientes:[], pasos:['Preparar.'] })),
        { idUsuario:1, dificultadSolicitada:'Todas', minutosMaximos:30, porciones:2, idSolicitud:id });
    return { estado, modelo, recetas, datos, guardar, pool, planes };
}

test('cinco generaciones Gratis; tres recetas consumen un cupo; sexta bloqueada', async () => {
    const e = entorno();
    for (let i=0;i<5;i++) {
        e.estado.ahora = new Date(+e.estado.ahora + 61000);
        const s = await e.modelo.reservar(1,e.datos());
        assert.equal((await e.guardar(s.id,3)).length,3);
    }
    assert.equal(e.estado.recetas.length,15);
    assert.equal(e.estado.solicitudes.filter(r => r.estado === 'exitosa').length,5);
    await assert.rejects(e.modelo.reservar(1,e.datos()), { code:'SUSCRIPCION_CUOTA_AGOTADA' });
});
test('fallo del lote revierte recetas, relaciones y consumo', async () => {
    const e=entorno(); const s=await e.modelo.reservar(1,e.datos()); e.estado.falloVinculo=true;
    await assert.rejects(e.guardar(s.id,3), /Fallo simulado/);
    assert.equal(e.estado.recetas.length,0); assert.equal(e.estado.vinculos.length,0);
    assert.equal(e.estado.solicitudes[0].estado,'reservada');
    await e.modelo.finalizar(s.id,1,false); assert.equal(e.estado.solicitudes[0].estado,'fallida');
});
test('idempotencia recupera IDs sin nuevas recetas; rechaza otra huella', async () => {
    const e=entorno(), d=e.datos(), s=await e.modelo.reservar(1,d); const ids=await e.guardar(s.id);
    const repetida=await e.modelo.reservar(1,d); assert.equal(repetida.repetida,true);
    const resultado=await e.modelo.recuperar(s.id,1); assert.equal(resultado.recetas[0].idReceta,ids[0]);
    assert.equal(e.estado.solicitudes.length,1); assert.equal(e.estado.recetas.length,1);
    await assert.rejects(e.modelo.reservar(1,{ ...d, huella:Buffer.alloc(32) }), { code:'SUSCRIPCION_CLAVE_REUTILIZADA' });
    assert.equal((await e.modelo.recuperar(s.id,2)).recetas.length,0);
});
test('MasterChef supera cinco solicitudes sin cuota', async () => {
    const e=entorno(); e.estado.plan={ id_suscripcion:2, codigo:'masterchef', masterchef:true, solicitudes_diarias:null };
    for(let i=0;i<7;i++) { e.estado.ahora=new Date(+e.estado.ahora+61000); const s=await e.modelo.reservar(1,e.datos()); await e.guardar(s.id); }
    assert.equal(e.estado.solicitudes.filter(r=>r.sujeta_cuota).length,0);
});
test('solicitudes simultáneas no ocupan más cupos ni más de dos plazas técnicas', async () => {
    const e=entorno();
    const resultados=await Promise.allSettled([e.modelo.reservar(1,e.datos()),e.modelo.reservar(1,e.datos()),e.modelo.reservar(1,e.datos())]);
    assert.equal(resultados.filter(r=>r.status==='fulfilled').length,2);
    assert.equal(resultados.find(r=>r.status==='rejected').reason.code,'SUSCRIPCION_CONCURRENCIA');
    const f=entorno();
    for(let i=0;i<4;i++) { f.estado.ahora=new Date(+f.estado.ahora+61000); const s=await f.modelo.reservar(1,f.datos()); await f.guardar(s.id); }
    f.estado.ahora=new Date(+f.estado.ahora+61000);
    const ultimas=await Promise.allSettled([f.modelo.reservar(1,f.datos()),f.modelo.reservar(1,f.datos())]);
    assert.equal(ultimas.filter(r=>r.status==='fulfilled').length,1);
});
test('frecuencia de usuario, IP y exclusión de repeticiones', async () => {
    const e=entorno();
    for(let i=0;i<3;i++) { const s=await e.modelo.reservar(1,e.datos()); await e.modelo.finalizar(s.id,1,false); }
    await assert.rejects(e.modelo.reservar(1,e.datos()),{ code:'SUSCRIPCION_FRECUENCIA' });
    const f=entorno();
    for(let i=1;i<=30;i++) { const s=await f.modelo.reservar(i,f.datos()); await f.modelo.finalizar(s.id,i,false); }
    await assert.rejects(f.modelo.reservar(31,f.datos()), { code:'SUSCRIPCION_FRECUENCIA_IP' });
    assert.equal(f.estado.solicitudes.length,30);
});
test('renovación: tres minutos iniciales, tope diez; vencida o cancelada no guarda', async () => {
    const e=entorno(), s=await e.modelo.reservar(1,e.datos()); const inicio=+e.estado.ahora;
    assert.equal(+e.estado.solicitudes[0].vence_en-inicio,180000);
    for(let i=0;i<19;i++) { e.estado.ahora=new Date(+e.estado.ahora+30000); assert.equal(await e.modelo.renovar(s.id,1),true); }
    assert.equal(+e.estado.solicitudes[0].vence_en-inicio,600000);
    e.estado.ahora=new Date(inicio+600000);
    assert.equal(await e.modelo.renovar(s.id,1),false);
    await assert.rejects(e.guardar(s.id),{ code:'SUSCRIPCION_RESERVA_VENCIDA' });
    const f=entorno(), cancelada=await f.modelo.reservar(1,f.datos()); await f.modelo.finalizar(cancelada.id,1,true);
    await assert.rejects(f.guardar(cancelada.id),{ code:'SUSCRIPCION_RESERVA_VENCIDA' });
    assert.equal(f.estado.recetas.length,0);
});
test('día de Chile, verano e invierno; solicitud cruza medianoche', async () => {
    assert.equal(reglas.diaChile(new Date('2026-11-04T02:59:59Z')),'2026-11-03');
    assert.equal(reglas.diaChile(new Date('2026-11-04T03:00:00Z')),'2026-11-04');
    assert.equal(reglas.diaChile(new Date('2026-07-04T03:59:59Z')),'2026-07-03');
    assert.equal(reglas.diaChile(new Date('2026-07-04T04:00:00Z')),'2026-07-04');
    const e=entorno(); e.estado.ahora=new Date('2026-11-04T02:59:30Z');
    const s=await e.modelo.reservar(1,e.datos()); e.estado.ahora=new Date('2026-11-04T03:00:01Z'); await e.guardar(s.id);
    assert.equal(e.estado.solicitudes[0].dia_reserva,'2026-11-03'); assert.equal(e.estado.solicitudes[0].dia_consumo,'2026-11-04');
});
test('huella estable, clave UUID y filtros no alterados', () => {
    const clave=randomUUID(); const req={ body:{ consulta:'Pollo',porciones:2 }, get:()=>clave, ip:'127.0.0.1' };
    const a=reglas.parametros(req), b=reglas.parametros({ ...req, body:{ porciones:2,consulta:'Pollo' } });
    assert.ok(a.huella.equals(b.huella)); assert.equal(a.clave,clave);
    assert.throws(()=>reglas.parametros({ ...req,get:()=> 'invalida' }),{ code:'SUSCRIPCION_CLAVE_INVALIDA' });
});
test('middleware consulta MySQL; sesión antigua MasterChef no autoriza Gratis', async () => {
    const e=entorno(); const middleware=cargar('middlewares/suscripciones.js', {
        '../models/suscripcionModel':e.planes, '../models/solicitudGeneracionModel':e.modelo });
    const req={ idUsuarioAutenticado:1, session:{ usuario:{ id_suscripcion:2 } } };
    let status, cuerpo, siguiente=0;
    const res={ status(n){status=n;return this;},json(v){cuerpo=v;} };
    await middleware.api(req,res,()=>siguiente++);
    assert.equal(status,403); assert.equal(cuerpo.code,'SUSCRIPCION_MASTERCHEF_REQUERIDO'); assert.equal(siguiente,0);
    e.estado.plan={ masterchef:true }; await middleware.api(req,res,()=>siguiente++); assert.equal(siguiente,1);
    req.body={ usarDespensa:true }; e.estado.plan={ masterchef:false };
    await middleware.generacion(req,res,()=>siguiente++); assert.equal(status,403); assert.equal(siguiente,1);
});
test('plan usa contratos vigentes y códigos, sin confiar en IDs de sesión', async () => {
    const consultas=[];
    const modelo=cargar('models/suscripcionModel.js',{ '../config/db': { execute:async (sql,p)=>{
        consultas.push(sql);
        return sql.includes('FROM usuario') ? [[{ id_usuario:7,id_suscripcion:42 }]]
            : [[{ id_suscripcion:42,codigo:'masterchef',nombre:'MasterChef',solicitudes_diarias:null }]];
    } } });
    assert.equal((await modelo.obtenerPlan(7)).masterchef,true);
    assert.match(consultas[1],/su.estado = 'activa'/); assert.match(consultas[1],/fecha_fin/);
    assert.ok(consultas.every(sql=>!sql.includes('tokens_disponibles')));
});
test('vistas EJS de ambos planes y aviso accesible; no aparece Essential/Premium', async () => {
    const ejs=require('ejs');
    for(const masterchef of [false,true]) {
        const html=await ejs.renderFile(path.resolve(__dirname,'../views/suscripciones.ejs'),{
            planActual:{ masterchef,codigo:masterchef?'masterchef':'gratis',nombre:masterchef?'MasterChef':'Gratis' },
            avisosSuscripcion:['Necesitas MasterChef.'] });
        assert.match(html,/role="alert"/); assert.match(html,/data-masterchef="/);
        assert.doesNotMatch(html,/Essential|Premium/);
        assert.equal(html.includes('aria-label="Requiere MasterChef"'),!masterchef);
    }
});

async function generarAislado({ masterchef=false, restricciones={ alergias:[],intolerancias:[] },
    ingrediente='Arroz', falloIA=false, usarDespensa=false, vacia=false, pendiente=false }={}) {
    const e=entorno(); if(masterchef) e.estado.plan={ id_suscripcion:2,codigo:'masterchef',masterchef:true,solicitudes_diarias:null };
    const restriccionesOriginales=structuredClone(restricciones), enviadas=[];
    let lecturasDespensa=0, historial=0;
    const controlador=cargar('controllers/recetasController.js', {
        '../models/ingredienteModel': { obtenerTiposAlimento:async()=>[{ id_tipo_alimento:1,nombre:'Cereal' }],
            obtenerReferenciasMedida:async()=>[], obtenerCatalogoSeguridad:async()=>[] },
        '../models/recetaModel':e.recetas, '../models/solicitudGeneracionModel':e.modelo,
        '../models/historialModel':{ registrarBusqueda:async()=>{ historial++; return 77; } },
        '../models/preferenciasModel':{ obtenerRestricciones:async()=>restricciones, obtenerVinculosRestricciones:async()=>[] },
        '../models/despensaModel':{ obtenerPorUsuario:async()=>{ lecturasDespensa++; return [{ ingrediente:'Arroz' }]; } },
        '../middlewares/suscripciones':{ responderError:(res,error)=>res.status(error.status||409).json({ ok:false,code:error.code }) },
        '../services/openaiService':{ generarRecetasConOpenAI:async opciones=>{
            enviadas.push(opciones);
            if(falloIA) throw Object.assign(new Error('Fallo simulado'),{ status:503 });
            if(vacia) { const r=[]; r.diagnosticoGeneracion={ recibidas:0,devueltas:0 }; return r; }
            const r=Array.from({length:3},(_,i)=>({ nombre:`Arroz ${i}`,dificultad:'Fácil',porciones:2,minutosPreparacion:20,
                ingredientes:[{ nombre:ingrediente,cantidad:100,unidad:'g',tipoAlimento:'Cereal',clasificacionPendiente:pendiente }],pasos:[`Preparar ${ingrediente}. Servir ${i}.`] }));
            r.diagnosticoGeneracion={ recibidas:3,devueltas:3 }; return r;
        } }
    });
    const req=new EventEmitter(); Object.assign(req,{ idUsuarioAutenticado:1, session:{ usuario:{ id_usuario:1 } },
        body:{ consulta:'Arroz',porciones:2,tiempoMaximo:30,dificultad:'Todas',usarDespensa },
        ip:'127.0.0.1', get:()=>null });
    req.datosSolicitudGeneracion=reglas.parametros(req);
    const res=new EventEmitter(); Object.assign(res,{ statusCode:200,writableFinished:false,headersSent:false,
        status(n){this.statusCode=n;return this;}, json(v){this.body=v;this.headersSent=true;this.writableFinished=true;return this;} });
    await controlador.generarRecetas(req,res,error=>{throw error;});
    assert.deepEqual(restricciones,restriccionesOriginales);
    return { ...e, req,res,enviadas,lecturasDespensa,historial };
}
for(const masterchef of [false,true]) {
    test(`controlador ${masterchef?'MasterChef':'Gratis'} conserva restricciones y sustituto compatible; guarda IDs`,async()=>{
        const restricciones={ alergias:['Pescado'],intolerancias:['Lactosa','Gluten','Cafeína'] };
        const e=await generarAislado({ masterchef,restricciones,ingrediente:'Leche sin lactosa',usarDespensa:masterchef });
        assert.equal(e.res.statusCode,200); assert.equal(e.res.body.recetas.length,3);
        assert.equal(e.res.body.recetas[0].idReceta,101);
        assert.equal(e.estado.solicitudes[0].estado,'exitosa');
        assert.deepEqual(e.enviadas[0].alergias,restricciones.alergias);
        assert.deepEqual(e.enviadas[0].intolerancias,restricciones.intolerancias);
        assert.equal(e.enviadas[0].cantidadRecetas,3);
        assert.equal(e.lecturasDespensa,Number(masterchef)); assert.equal(e.historial,1);
    });
}
test('controlador mantiene el rechazo de leche común con lactosa; no consume ni guarda',async()=>{
    const e=await generarAislado({ restricciones:{ alergias:[],intolerancias:['Lactosa'] },ingrediente:'Leche' });
    assert.equal(e.res.statusCode,422); assert.equal(e.estado.recetas.length,0);
    assert.equal(e.estado.solicitudes[0].estado,'fallida'); assert.equal(e.enviadas.length,2);
});
test('controlador mantiene el bloqueo de alergia a leche incluso sin lactosa',async()=>{
    const e=await generarAislado({ restricciones:{ alergias:['Leche'],intolerancias:[] },ingrediente:'Leche sin lactosa' });
    assert.equal(e.res.statusCode,422); assert.equal(e.estado.recetas.length,0);
    assert.equal(e.estado.solicitudes[0].estado,'fallida');
});
test('error OpenAI conserva flujo de error y libera cuota sin guardar',async()=>{
    const e=await generarAislado({ falloIA:true });
    assert.equal(e.res.statusCode,503); assert.equal(e.estado.recetas.length,0);
    assert.equal(e.estado.solicitudes[0].estado,'fallida'); assert.equal(e.historial,0);
});
test('cero resultados o solo propuestas pendientes no consumen cuota',async()=>{
    const vacia=await generarAislado({ vacia:true });
    assert.equal(vacia.enviadas.length,2); assert.equal(vacia.estado.solicitudes[0].estado,'fallida');
    assert.equal(vacia.estado.recetas.length,0);
    const pendiente=await generarAislado({ pendiente:true });
    assert.equal(pendiente.res.body.ok,true); assert.equal(pendiente.estado.recetas.length,0);
    assert.equal(pendiente.estado.solicitudes[0].estado,'fallida');
    assert.equal(pendiente.res.body.recetas[0].verificacionAlimentaria.estado,'pendiente');
});
test('cupo del nuevo día agotado impide confirmar una reserva del día anterior',async()=>{
    const e=entorno(); e.estado.ahora=new Date('2026-11-04T02:59:30Z');
    const s=await e.modelo.reservar(1,e.datos());
    for(let i=0;i<5;i++) e.estado.solicitudes.push({ id_solicitud:100+i,id_usuario:1,estado:'exitosa',sujeta_cuota:true,
        dia_consumo:'2026-11-04',creada_en:new Date('2026-11-04T03:00:00Z') });
    e.estado.ahora=new Date('2026-11-04T03:00:01Z');
    await assert.rejects(e.guardar(s.id),{ code:'SUSCRIPCION_CUOTA_AGOTADA' });
    assert.equal(e.estado.recetas.length,0);
});
test('redirección de página usa aviso propio; las APIs no consumen ese aviso',async()=>{
    const e=entorno(), avisos=[];
    const m=cargar('middlewares/suscripciones.js',{ '../models/suscripcionModel':e.planes,'../models/solicitudGeneracionModel':e.modelo });
    const req={ idUsuarioAutenticado:1,path:'/despensa',flash:(tipo,texto)=>{
        assert.equal(tipo,'suscripcion'); if(texto) avisos.push(texto); else return avisos.splice(0);
    } };
    let destino;
    const res={ locals:{},redirect:r=>{destino=r;},status(){return this;},json(){} };
    await m.pagina(req,res,()=>assert.fail('No autorizar Gratis'));
    assert.equal(destino,'/suscripciones'); assert.equal(avisos.length,1);
    await m.api(req,res,()=>assert.fail('No autorizar API Gratis')); assert.equal(avisos.length,1);
    req.path='/suscripciones'; await m.cargarPlan(req,res,error=>{if(error)throw error;});
    assert.equal(res.locals.avisosSuscripcion.length,1); assert.equal(avisos.length,0);
});
