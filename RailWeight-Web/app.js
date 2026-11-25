// ==========================================================================
// RAILWEIGHT - INTEGRACIÓN COMPLETA CON SUPABASE (AUTH, RLS, VISTAS Y REALTIME)
// ==========================================================================

const SUPABASE_URL = "https://yuktbfecmkzvfarfhgwr.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_dmZ1jidOjrJo5J8lnnAyJw_97sLq2yA";

const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Estado global en memoria (alimentado directamente desde Supabase)
let perfilActual = null;
let correoActual = "";
let listaEstaciones = [];
let listaContenedores = [];
let listaMateriales = [];
let registrosMediciones = [];
let contenedorActivo = null;

let tipoSuperficieActual = "Montículo Central";
let chartSensores = null;
let canalRealtime = null;
let timerDebounceLive = null;
let intentosFallidos = 0;
let bloqueoHasta = 0;

// Sanitización segura contra XSS
function sanitizarTexto(texto) {
    return String(texto ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

function crearClaveMaterial(nombre) {
    const slug = nombre
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "_")
        .replace(/^_+|_+$/g, "")
        .slice(0, 32);
    return slug.length >= 2 ? `${slug}_${String(Date.now()).slice(-4)}` : `mat_${Date.now()}`;
}

function formatearFechaHora(isoString) {
    if (!isoString) return "--";
    return new Date(isoString).toLocaleString("es-MX", {
        dateStyle: "short",
        timeStyle: "short"
    });
}

document.addEventListener("DOMContentLoaded", () => {
    document.getElementById("inputEspEndpoint").value = `${SUPABASE_URL}/rest/v1/rpc/enviar_lectura_esp32`;
    inicializarMenuLateral();
    inicializarGraficaLongitudinal();
    inicializarEventosAuth();
    inicializarEventosCalculo();
    inicializarEventosCatalogoYContenedores();
    verificarSesionInicial();
});

// ================= 1. AUTENTICACIÓN, RECUPERACIÓN Y CAMBIO DE CONTRASEÑA =================
function mostrarMensajeLogin(mensaje, tipo = "error") {
    const errBox = document.getElementById("loginAlert");
    const okBox = document.getElementById("loginSuccess");
    errBox.classList.add("d-none");
    okBox.classList.add("d-none");

    if (!mensaje) return;
    if (tipo === "ok") {
        okBox.textContent = mensaje;
        okBox.classList.remove("d-none");
    } else {
        errBox.textContent = mensaje;
        errBox.classList.remove("d-none");
    }
}

function mostrarVistaAuth(vista) {
    document.getElementById("panelLogin").classList.toggle("d-none", vista !== "login");
    document.getElementById("panelRecuperar").classList.toggle("d-none", vista !== "recuperar");
    document.getElementById("panelNuevaPass").classList.toggle("d-none", vista !== "nuevaPass");
    mostrarMensajeLogin("");
}

function inicializarEventosAuth() {
    document.getElementById("btnMostrarRecuperar").addEventListener("click", () => {
        mostrarVistaAuth("recuperar");
    });

    document.getElementById("btnVolverLogin").addEventListener("click", () => {
        mostrarVistaAuth("login");
    });

    // Inicio de sesión real con Supabase Auth
    document.getElementById("formLogin").addEventListener("submit", async (e) => {
        e.preventDefault();
        const ahora = Date.now();
        if (ahora < bloqueoHasta) {
            const segs = Math.ceil((bloqueoHasta - ahora) / 1000);
            mostrarMensajeLogin(`Acceso bloqueado temporalmente por seguridad. Intenta en ${segs} segundos.`);
            return;
        }

        const email = document.getElementById("loginEmail").value.trim().toLowerCase();
        const password = document.getElementById("loginPassword").value;
        const btn = document.getElementById("btnSubmitLogin");
        btn.disabled = true;

        try {
            const { data, error } = await sb.auth.signInWithPassword({ email, password });
            if (error) {
                intentosFallidos++;
                if (intentosFallidos >= 3) {
                    bloqueoHasta = Date.now() + 15000;
                    mostrarMensajeLogin("Demasiados intentos fallidos. Acceso bloqueado por 15 segundos.");
                } else {
                    mostrarMensajeLogin("Correo o contraseña incorrectos. Verifica tus credenciales.");
                }
                return;
            }

            intentosFallidos = 0;
            document.getElementById("loginPassword").value = "";
            await iniciarAplicacionConSesion(data.session);
        } catch (err) {
            mostrarMensajeLogin("Error de conexión con el servidor. Verifica tu internet y tu llave de Supabase.");
        } finally {
            btn.disabled = false;
        }
    });

    // Solicitud de correo de recuperación
    document.getElementById("formRecuperar").addEventListener("submit", async (e) => {
        e.preventDefault();
        const email = document.getElementById("recuperarEmail").value.trim().toLowerCase();
        const redirectTo = window.location.origin + window.location.pathname;

        const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo });
        if (error) {
            mostrarMensajeLogin("No se pudo enviar el correo de recuperación: " + error.message);
            return;
        }
        mostrarMensajeLogin("Si el correo está registrado, recibirás un enlace para restablecer tu contraseña.", "ok");
    });

    // Definir nueva contraseña tras enlace de recuperación
    document.getElementById("formNuevaPass").addEventListener("submit", async (e) => {
        e.preventDefault();
        const p1 = document.getElementById("resetNewPass").value;
        const p2 = document.getElementById("resetConfirmPass").value;

        if (p1.length < 8) {
            mostrarMensajeLogin("La contraseña debe tener al menos 8 caracteres.");
            return;
        }
        if (p1 !== p2) {
            mostrarMensajeLogin("Las contraseñas no coinciden.");
            return;
        }

        const { error } = await sb.auth.updateUser({ password: p1 });
        if (error) {
            mostrarMensajeLogin("Error al actualizar contraseña: " + error.message);
            return;
        }

        e.target.reset();
        mostrarVistaAuth("login");
        mostrarMensajeLogin("Contraseña actualizada correctamente. Ya puedes iniciar sesión.", "ok");
    });

    // Cambiar contraseña desde el Perfil (sesión iniciada)
    document.getElementById("formCambiarPassword").addEventListener("submit", async (e) => {
        e.preventDefault();
        const p1 = document.getElementById("perfilNewPass").value;
        const p2 = document.getElementById("perfilConfirmPass").value;
        const alertBox = document.getElementById("perfilPassAlert");
        alertBox.className = "alert py-2 small";

        if (p1.length < 8) {
            alertBox.classList.add("alert-danger");
            alertBox.textContent = "La contraseña debe tener al menos 8 caracteres.";
            return;
        }
        if (p1 !== p2) {
            alertBox.classList.add("alert-danger");
            alertBox.textContent = "Las contraseñas no coinciden.";
            return;
        }

        const { error } = await sb.auth.updateUser({ password: p1 });
        if (error) {
            alertBox.classList.add("alert-danger");
            alertBox.textContent = "Error al cambiar la contraseña: " + error.message;
            return;
        }

        e.target.reset();
        alertBox.classList.add("alert-success");
        alertBox.textContent = "Contraseña actualizada correctamente.";
    });

    // Cerrar sesión segura
    document.getElementById("btnCerrarSesion").addEventListener("click", async () => {
        if (canalRealtime) {
            await sb.removeChannel(canalRealtime);
            canalRealtime = null;
        }
        await sb.auth.signOut();
        perfilActual = null;
        mostrarVistaAuth("login");
        document.getElementById("loginOverlay").classList.remove("hidden");
    });

    // Detectar evento de recuperación desde el correo
    sb.auth.onAuthStateChange((event) => {
        if (event === "PASSWORD_RECOVERY") {
            document.getElementById("loginOverlay").classList.remove("hidden");
            mostrarVistaAuth("nuevaPass");
        }
    });
}

async function verificarSesionInicial() {
    if (SUPABASE_ANON_KEY.includes("PEGA_AQUI")) {
        mostrarMensajeLogin("Falta pegar tu llave pública (Publishable/anon) en la línea 6 de app.js.");
        return;
    }

    const { data: { session } } = await sb.auth.getSession();
    if (session) {
        await iniciarAplicacionConSesion(session);
    }
}

async function iniciarAplicacionConSesion(session) {
    correoActual = session.user.email || "";

    const { data: perfil, error } = await sb
        .from("vista_usuarios_perfil")
        .select("*")
        .eq("id_usuario", session.user.id)
        .single();

    if (error || !perfil) {
        await sb.auth.signOut();
        mostrarMensajeLogin("Tu cuenta existe, pero no está vinculada a un perfil operativo en la tabla usuarios.");
        return;
    }

    perfilActual = perfil;
    aplicarDatosOperador(perfil);
    aplicarPermisosPorRol(perfil.clave_rol);
    document.getElementById("loginOverlay").classList.add("hidden");

    await cargarTodosLosDatos();
    suscribirLecturasTiempoReal();
}

function aplicarDatosOperador(perfil) {
    document.getElementById("sidebarAvatar").textContent = perfil.iniciales;
    document.getElementById("sidebarUserName").textContent = perfil.nombre_corto;
    document.getElementById("sidebarUserStation").textContent = perfil.nombre_estacion;
    document.getElementById("headerStationText").textContent = perfil.nombre_estacion;

    document.getElementById("profileBigAvatar").textContent = perfil.iniciales;
    document.getElementById("profileName").textContent = perfil.nombre_completo;
    document.getElementById("profileRole").textContent = perfil.rol_operativo;
    document.getElementById("profileUsername").textContent = perfil.username;
    document.getElementById("profileEmail").textContent = correoActual;
    document.getElementById("profileStation").textContent = perfil.nombre_estacion;
    document.getElementById("profileMunicipio").textContent = `${perfil.municipio} • ${perfil.linea_ferroviaria}`;
    document.getElementById("profileLoginTime").textContent = formatearFechaHora(new Date().toISOString());
}

function aplicarPermisosPorRol(claveRol) {
    const esAdmin = claveRol === "admin";
    const esGestor = claveRol === "admin" || claveRol === "supervisor";

    // Contenedores: solo Admin de estación puede registrar o desactivar
    document.getElementById("cardNuevoContenedor").classList.toggle("d-none", !esAdmin);
    document.getElementById("avisoPermisoContenedor").classList.toggle("d-none", esAdmin);

    // Materiales: solo Admin y Supervisor pueden añadir
    document.getElementById("cardNuevoMaterial").classList.toggle("d-none", !esGestor);
    document.getElementById("avisoPermisoMaterial").classList.toggle("d-none", esGestor);

    // Estación de registro y filtro de todo Tabasco: solo Admin y Supervisor
    document.getElementById("bloqueEstacionMedicion").classList.toggle("d-none", !esGestor);
    document.getElementById("bloqueFiltroEstacion").classList.toggle("d-none", !esGestor);
}

// ================= 2. CARGA DE DATOS DESDE SUPABASE =================
async function cargarTodosLosDatos() {
    await Promise.all([
        cargarEstaciones(),
        cargarContenedores(),
        cargarMateriales()
    ]);

    await cargarLecturaEnVivo();
    await cargarHistorialMediciones();
    recalcularSistema();
}

async function cargarEstaciones() {
    const { data, error } = await sb
        .from("estaciones")
        .select("*")
        .eq("activa", true)
        .order("id_estacion", { ascending: true });

    if (error || !data) return;
    listaEstaciones = data;

    const selMedicion = document.getElementById("selectEstacionMedicion");
    selMedicion.innerHTML = listaEstaciones.map(e =>
        `<option value="${e.id_estacion}">${sanitizarTexto(e.nombre_estacion)} (${sanitizarTexto(e.municipio)})</option>`
    ).join("");
    if (perfilActual) selMedicion.value = String(perfilActual.id_estacion);

    const selFiltro = document.getElementById("filtroEstacionHistorial");
    selFiltro.innerHTML = `<option value="todas">Todas las estaciones de Tabasco</option>` +
        listaEstaciones.map(e =>
            `<option value="${e.id_estacion}">${sanitizarTexto(e.nombre_estacion)}</option>`
        ).join("");
}

async function cargarContenedores() {
    const { data, error } = await sb
        .from("vista_contenedores_capacidad")
        .select("*")
        .order("id_contenedor", { ascending: true });

    if (error || !data) return;
    listaContenedores = data;

    const activos = listaContenedores.filter(c => c.activo);
    const selectCont = document.getElementById("selectContenedor");
    const prevId = selectCont.value;

    selectCont.innerHTML = activos.map(c =>
        `<option value="${c.id_contenedor}">${sanitizarTexto(c.codigo_vagon)} (${Number(c.largo_base_cm)}×${Number(c.ancho_base_cm)} cm • Útil ${Number(c.alto_util_cm)} cm)</option>`
    ).join("");

    if (prevId && activos.some(c => String(c.id_contenedor) === prevId)) {
        selectCont.value = prevId;
    }

    contenedorActivo = activos.find(c => String(c.id_contenedor) === selectCont.value) || activos[0] || null;
    renderizarTablaContenedores();
}

async function cargarMateriales() {
    const { data, error } = await sb
        .from("materiales")
        .select("*")
        .eq("activo", true)
        .order("id_material", { ascending: true });

    if (error || !data) return;
    listaMateriales = data;

    const selectMat = document.getElementById("selectMaterial");
    const prevId = selectMat.value;

    selectMat.innerHTML = listaMateriales.map(m =>
        `<option value="${m.id_material}">${sanitizarTexto(m.nombre_material)}</option>`
    ).join("");

    if (prevId && listaMateriales.some(m => String(m.id_material) === prevId)) {
        selectMat.value = prevId;
    }

    const tbodyCat = document.getElementById("tablaCatalogoBody");
    tbodyCat.innerHTML = listaMateriales.map(m => `
        <tr>
            <td><strong>${sanitizarTexto(m.nombre_material)}</strong></td>
            <td>${Number(m.densidad_suelta_gcm3).toFixed(2)} g/cm³ <small class="text-muted">(${Math.round(Number(m.densidad_suelta_gcm3) * 1000).toLocaleString("es-MX")} kg/m³)</small></td>
            <td>${Number(m.densidad_compactada_gcm3).toFixed(2)} g/cm³ <small class="text-muted">(${Math.round(Number(m.densidad_compactada_gcm3) * 1000).toLocaleString("es-MX")} kg/m³)</small></td>
            <td>${sanitizarTexto(m.descripcion_uso)}</td>
        </tr>
    `).join("");
}

async function cargarLecturaEnVivo() {
    if (!contenedorActivo) return;

    const { data, error } = await sb
        .from("vista_lecturas_live")
        .select("*")
        .eq("id_contenedor", contenedorActivo.id_contenedor)
        .maybeSingle();

    if (error || !data) {
        document.getElementById("lblUltimaLecturaLive").textContent = "Sin lectura del ESP32";
        return;
    }

    const fecha = formatearFechaHora(data.actualizado_en);
    document.getElementById("lblUltimaLecturaLive").textContent = `ESP32: ${fecha}`;
    document.getElementById("lblUltimaConexionEsp").textContent = fecha;
    document.getElementById("espStatusText").textContent = `ESP32 activo • ${fecha}`;

    setDistancias(
        Number(data.d1_cm).toFixed(1),
        Number(data.d2_cm).toFixed(1),
        Number(data.d3_cm).toFixed(1),
        Number(data.d4_cm).toFixed(1),
        Number(data.d5_cm).toFixed(1),
        "Lectura de Sensores"
    );
}

async function cargarHistorialMediciones() {
    const filtroEstacion = document.getElementById("filtroEstacionHistorial").value;
    let query = sb
        .from("vista_mediciones_calculadas")
        .select("*")
        .order("fecha_hora_registro", { ascending: false })
        .limit(100);

    if (filtroEstacion && filtroEstacion !== "todas") {
        query = query.eq("id_estacion", Number(filtroEstacion));
    }

    const { data, error } = await query;
    const tbody = document.getElementById("tablaRegistrosBody");

    if (error) {
        tbody.innerHTML = `<tr><td colspan="8" class="text-center text-danger py-4">Error al cargar historial: ${sanitizarTexto(error.message)}</td></tr>`;
        return;
    }

    registrosMediciones = data || [];
    if (registrosMediciones.length === 0) {
        tbody.innerHTML = `<tr><td colspan="8" class="text-center text-muted py-4">Aún no hay mediciones registradas. Usa "Guardar en Historial" para crear el primer folio.</td></tr>`;
        return;
    }

    tbody.innerHTML = registrosMediciones.map(r => `
        <tr>
            <td><strong>#${r.id_medicion}</strong></td>
            <td>${sanitizarTexto(formatearFechaHora(r.fecha_hora_registro))}</td>
            <td>${sanitizarTexto(r.nombre_estacion)} • <strong>${sanitizarTexto(r.codigo_vagon)}</strong></td>
            <td>${sanitizarTexto(r.operador_nombre_corto)}</td>
            <td>${sanitizarTexto(r.nombre_material)} (${Number(r.densidad_aplicada_gcm3).toFixed(2)} g/cm³)</td>
            <td><span class="badge bg-success-subtle text-success border border-success-subtle">${Number(r.nivel_llenado_pct).toFixed(1)} %</span></td>
            <td>${Math.round(Number(r.volumen_ocupado_cm3)).toLocaleString("es-MX")} cm³</td>
            <td><strong class="text-dark">${Number(r.masa_estimada_kg).toFixed(2)} kg</strong></td>
        </tr>
    `).join("");
}

function suscribirLecturasTiempoReal() {
    if (canalRealtime) sb.removeChannel(canalRealtime);

    canalRealtime = sb
        .channel("rw-lecturas-live")
        .on("postgres_changes", { event: "*", schema: "public", table: "lecturas_live" }, () => {
            clearTimeout(timerDebounceLive);
            timerDebounceLive = setTimeout(() => {
                cargarLecturaEnVivo();
            }, 250);
        })
        .subscribe((status) => {
            const badge = document.getElementById("badgeRealtimeStatus");
            if (status === "SUBSCRIBED") {
                badge.textContent = "Suscrito en Tiempo Real";
                badge.className = "badge bg-success-subtle text-success border border-success-subtle";
            } else {
                badge.textContent = status;
            }
        });
}

// ================= 3. MENÚ LATERAL Y GRÁFICA LONGITUDINAL =================
function inicializarMenuLateral() {
    const layout = document.getElementById("appLayout");
    const btnToggle = document.getElementById("btnToggleSidebar");
    const links = document.querySelectorAll(".rw-nav-link");
    const panes = document.querySelectorAll(".rw-tab-pane");

    const titulosPestanas = {
        "tab-calculo": ["Cálculo de Masa y Monitoreo Longitudinal", "Estimación volumétrica mediante arreglo lineal de 5 sensores ultrasónicos"],
        "tab-registros": ["Historial de Registros de Pesaje", "Bitácora operativa inmutable almacenada en la base de datos"],
        "tab-catalogo": ["Catálogo de Materiales y Contenedores", "Consulta de densidades y administración de contenedores registrados"],
        "tab-conexion": ["Conexión ESP32 y Seguridad de Red", "Enlace HTTPS con el microcontrolador y estado de Supabase"],
        "tab-perfil": ["Perfil del Operador Autenticado", "Información de la sesión activa y seguridad de contraseña"]
    };

    btnToggle.addEventListener("click", () => {
        layout.classList.toggle("sidebar-collapsed");
    });

    function activarPestana(tabId) {
        links.forEach(l => l.classList.toggle("active", l.dataset.tab === tabId));
        panes.forEach(p => p.classList.toggle("active", p.id === tabId));
        if (titulosPestanas[tabId]) {
            document.getElementById("pageTitle").textContent = titulosPestanas[tabId][0];
            document.getElementById("pageSubtitle").textContent = titulosPestanas[tabId][1];
        }
        if (tabId === "tab-registros" && perfilActual) {
            cargarHistorialMediciones();
        }
    }

    links.forEach(link => link.addEventListener("click", () => activarPestana(link.dataset.tab)));
    document.getElementById("sidebarUserCard").addEventListener("click", () => activarPestana("tab-perfil"));
}

function inicializarGraficaLongitudinal() {
    const ctx = document.getElementById("chartSensores").getContext("2d");
    chartSensores = new Chart(ctx, {
        type: "line",
        data: {
            labels: [
                "Sensor 1 (Frente)",
                "Sensor 2 (Intermedio F.)",
                "Sensor 3 (Centro)",
                "Sensor 4 (Intermedio P.)",
                "Sensor 5 (Posterior)"
            ],
            datasets: [{
                label: "Altura del Material (cm)",
                data: [0, 0, 0, 0, 0],
                borderColor: "#2E7D32",
                backgroundColor: "rgba(46, 125, 50, 0.18)",
                borderWidth: 3,
                pointBackgroundColor: "#E65100",
                pointRadius: 5,
                fill: true,
                tension: 0.25
            }]
        },
        options: {
            responsive: true,
            plugins: { legend: { display: false } },
            scales: {
                y: {
                    beginAtZero: true,
                    max: 11,
                    title: { display: true, text: "Altura de carga (cm)" }
                }
            }
        }
    });
}

// ================= 4. CÁLCULO EXACTO (TRAPECIO + PAREDES INCLINADAS) =================
function calcularVolumenTronco(l0, w0, l1, w1, altoUtil, h, factorCal) {
    if (h <= 0 || altoUtil <= 0) return 0;
    const ratio = Math.min(h, altoUtil) / altoUtil;
    const lh = l0 + (l1 - l0) * ratio;
    const wh = w0 + (w1 - w0) * ratio;
    return (h / 6) * ((l0 * w0) + (lh * wh) + ((l0 + lh) * (w0 + wh))) * factorCal;
}

function recalcularSistema() {
    if (!contenedorActivo || listaMateriales.length === 0) return;

    const matId = Number(document.getElementById("selectMaterial").value);
    const estadoKey = document.getElementById("selectEstadoMaterial").value;
    const materialObj = listaMateriales.find(m => m.id_material === matId) || listaMateriales[0];

    const densidad = estadoKey === "suelta"
        ? Number(materialObj.densidad_suelta_gcm3)
        : Number(materialObj.densidad_compactada_gcm3);
    document.getElementById("inputDensidad").value = densidad.toFixed(2);

    const l0 = Number(contenedorActivo.largo_base_cm);
    const w0 = Number(contenedorActivo.ancho_base_cm);
    const l1 = Number(contenedorActivo.largo_sup_cm);
    const w1 = Number(contenedorActivo.ancho_sup_cm);
    const altoUtil = Number(contenedorActivo.alto_util_cm);
    const alturaSensor = Number(contenedorActivo.altura_sensor_cm);
    const factorCal = Number(contenedorActivo.factor_calibracion);

    let alertaZonaCiega = false;
    let alertaSobrellenado = false;

    const ids = ["d1", "d2", "d3", "d4", "d5"];
    const alturas = ids.map((id, index) => {
        const inputEl = document.getElementById(id);
        let d = parseFloat(inputEl.value);
        if (isNaN(d) || d < 0) d = 0;

        if (d < 2.0) alertaZonaCiega = true;
        const h = Math.max(0, alturaSensor - d);
        if (h > altoUtil + 0.05) alertaSobrellenado = true;

        document.getElementById(`h${index + 1}`).textContent = `${h.toFixed(1)} cm`;
        return h;
    });

    const alertaBox = document.getElementById("alertaSensores");
    if (alertaZonaCiega) {
        alertaBox.textContent = "Advertencia: Uno o más sensores marcan menos de 2.0 cm (dentro de la zona ciega del sensor HC-SR04).";
        alertaBox.classList.remove("d-none");
    } else if (alertaSobrellenado) {
        alertaBox.textContent = `Aviso: El material supera el límite útil configurado de ${altoUtil.toFixed(1)} cm en algún punto del contenedor.`;
        alertaBox.classList.remove("d-none");
    } else {
        alertaBox.classList.add("d-none");
    }

    // Regla del Trapecio Compuesta para 5 sensores en fila
    const alturaProm = (alturas[0] + 2 * alturas[1] + 2 * alturas[2] + 2 * alturas[3] + alturas[4]) / 8;
    const capacidadUtilCm3 = Number(contenedorActivo.capacidad_util_cm3);
    const volumenOcupadoCm3 = calcularVolumenTronco(l0, w0, l1, w1, altoUtil, alturaProm, factorCal);
    const nivelPct = capacidadUtilCm3 > 0 ? (volumenOcupadoCm3 / capacidadUtilCm3) * 100 : 0;

    const masaGramos = volumenOcupadoCm3 * densidad;
    const masaKg = masaGramos / 1000;

    // Banner principal
    document.getElementById("resMasaKg").textContent = masaKg.toFixed(2);
    document.getElementById("resMasaGramos").textContent = `(${Math.round(masaGramos).toLocaleString("es-MX")} g)`;
    document.getElementById("resMaterialNombre").textContent = materialObj.nombre_material;
    document.getElementById("resDensidadVal").textContent = `${densidad.toFixed(2)} g/cm³`;
    document.getElementById("resVolumenCm3").textContent = `${Math.round(volumenOcupadoCm3).toLocaleString("es-MX")} cm³`;
    document.getElementById("resCapMax").textContent = `${Math.round(capacidadUtilCm3).toLocaleString("es-MX")} cm³`;
    document.getElementById("resNivelPct").textContent = `${nivelPct.toFixed(1)} %`;
    document.getElementById("resAlturaProm").textContent = `${alturaProm.toFixed(1)} cm`;
    document.getElementById("resTipoSuperficie").textContent = `Distribución: ${tipoSuperficieActual}`;

    // Ficha geométrica en solo lectura
    document.getElementById("badgeCodigoVagon").textContent = contenedorActivo.codigo_vagon;
    document.getElementById("lblBaseActiva").textContent = `${l0.toFixed(1)} × ${w0.toFixed(1)} cm`;
    document.getElementById("lblSupActiva").textContent = `${l1.toFixed(1)} × ${w1.toFixed(1)} cm`;
    document.getElementById("lblAltoUtilActivo").textContent = `${altoUtil.toFixed(1)} cm`;
    document.getElementById("lblAltoSensorActivo").textContent = `${alturaSensor.toFixed(1)} cm`;

    if (chartSensores) {
        chartSensores.options.scales.y.max = Math.max(altoUtil, ...alturas);
        chartSensores.data.datasets[0].data = alturas;
        chartSensores.update();
    }
}

function setDistancias(d1, d2, d3, d4, d5, etiqueta) {
    document.getElementById("d1").value = d1;
    document.getElementById("d2").value = d2;
    document.getElementById("d3").value = d3;
    document.getElementById("d4").value = d4;
    document.getElementById("d5").value = d5;
    tipoSuperficieActual = etiqueta;
    recalcularSistema();
}

// ================= 5. EVENTOS DE OPERACIÓN Y GUARDADO EN BD =================
function inicializarEventosCalculo() {
    document.getElementById("selectContenedor").addEventListener("change", async (e) => {
        const idSel = Number(e.target.value);
        contenedorActivo = listaContenedores.find(c => c.id_contenedor === idSel) || null;
        await cargarLecturaEnVivo();
        recalcularSistema();
    });

    ["selectMaterial", "selectEstadoMaterial", "d1", "d2", "d3", "d4", "d5"].forEach(id => {
        document.getElementById(id).addEventListener("input", recalcularSistema);
    });

    // Presets ajustados a la altura útil real (0 a alto_util_cm)
    document.querySelectorAll("[data-preset]").forEach(btn => {
        btn.addEventListener("click", () => {
            if (!contenedorActivo) return;
            document.querySelectorAll("[data-preset]").forEach(b => b.classList.remove("active"));
            btn.classList.add("active");

            const hSensor = Number(contenedorActivo.altura_sensor_cm);
            const hUtil = Number(contenedorActivo.alto_util_cm);
            const preset = btn.dataset.preset;

            if (preset === "plana") {
                const d = (hSensor - hUtil * 0.55).toFixed(1);
                setDistancias(d, d, d, d, d, "Carga Plana");
            } else if (preset === "monticulo") {
                setDistancias(
                    (hSensor - hUtil * 0.36).toFixed(1),
                    (hSensor - hUtil * 0.52).toFixed(1),
                    (hSensor - hUtil * 0.68).toFixed(1),
                    (hSensor - hUtil * 0.50).toFixed(1),
                    (hSensor - hUtil * 0.34).toFixed(1),
                    "Montículo Central"
                );
            } else if (preset === "inclinada") {
                setDistancias(
                    (hSensor - hUtil * 0.72).toFixed(1),
                    (hSensor - hUtil * 0.60).toFixed(1),
                    (hSensor - hUtil * 0.48).toFixed(1),
                    (hSensor - hUtil * 0.36).toFixed(1),
                    (hSensor - hUtil * 0.24).toFixed(1),
                    "Carga Inclinada"
                );
            }
        });
    });

    // Solicitar última lectura real guardada por el ESP32
    document.getElementById("btnQuickSim").addEventListener("click", async () => {
        await cargarLecturaEnVivo();
    });

    // Guardar medición transaccional (encabezado + 5 sensores) en Supabase
    document.getElementById("btnGuardarDirecto").addEventListener("click", async () => {
        if (!perfilActual || !contenedorActivo) return;

        const btn = document.getElementById("btnGuardarDirecto");
        btn.disabled = true;

        try {
            const esGestor = perfilActual.clave_rol === "admin" || perfilActual.clave_rol === "supervisor";
            const idEstacion = esGestor
                ? Number(document.getElementById("selectEstacionMedicion").value)
                : Number(perfilActual.id_estacion);

            const idMaterial = Number(document.getElementById("selectMaterial").value);
            const estadoMaterial = document.getElementById("selectEstadoMaterial").value;
            const leerD = (id) => Math.min(400, Math.max(0, Number(parseFloat(document.getElementById(id).value) || 0)));

            const { data: nuevoFolio, error } = await sb.rpc("registrar_medicion_completa", {
                p_id_estacion: idEstacion,
                p_id_contenedor: Number(contenedorActivo.id_contenedor),
                p_id_material: idMaterial,
                p_estado_material: estadoMaterial,
                p_distribucion_carga: tipoSuperficieActual,
                p_d1: leerD("d1"),
                p_d2: leerD("d2"),
                p_d3: leerD("d3"),
                p_d4: leerD("d4"),
                p_d5: leerD("d5")
            });

            if (error) {
                alert("No se pudo guardar la medición: " + error.message);
                return;
            }

            await cargarHistorialMediciones();
            alert(`Estimación registrada en la base de datos con el Folio #${nuevoFolio}.`);
        } finally {
            btn.disabled = false;
        }
    });

    document.getElementById("filtroEstacionHistorial").addEventListener("change", cargarHistorialMediciones);
    document.getElementById("btnRecargarHistorial").addEventListener("click", cargarHistorialMediciones);

    // Exportar CSV con BOM UTF-8 para abrir bien acentos en Excel
    document.getElementById("btnExportarCSV").addEventListener("click", () => {
        if (registrosMediciones.length === 0) {
            alert("No hay registros disponibles para exportar.");
            return;
        }
        let csv = "\uFEFFFolio,Fecha y Hora,Estacion,Vagon,Operador,Material,Densidad (g/cm3),Nivel (%),Volumen (cm3),Masa Estimada (kg)\n";
        registrosMediciones.forEach(r => {
            csv += `"#${r.id_medicion}","${formatearFechaHora(r.fecha_hora_registro)}","${r.nombre_estacion}","${r.codigo_vagon}","${r.operador_nombre_corto}","${r.nombre_material}","${Number(r.densidad_aplicada_gcm3).toFixed(2)}","${Number(r.nivel_llenado_pct).toFixed(1)}","${Number(r.volumen_ocupado_cm3).toFixed(2)}","${Number(r.masa_estimada_kg).toFixed(2)}"\n`;
        });
        const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
        const link = document.createElement("a");
        link.href = URL.createObjectURL(blob);
        link.download = "Bitacora_RailWeight.csv";
        link.click();
    });
}

// ================= 6. GESTIÓN DE CATÁLOGO Y CONTENEDORES (CON RLS) =================
function renderizarTablaContenedores() {
    const tbody = document.getElementById("tablaContenedoresBody");
    const esAdmin = perfilActual && perfilActual.clave_rol === "admin";

    tbody.innerHTML = listaContenedores.map(c => {
        const esDeSuEstacion = esAdmin && Number(c.id_estacion_registro) === Number(perfilActual.id_estacion);
        const badgeEstado = c.activo
            ? `<span class="badge bg-success-subtle text-success border border-success-subtle">Activo</span>`
            : `<span class="badge bg-secondary-subtle text-secondary border">Inactivo</span>`;

        const btnToggle = esDeSuEstacion
            ? `<button type="button" class="btn btn-link btn-sm p-0 ms-2 text-decoration-none" data-toggle-cont="${c.id_contenedor}" data-estado="${c.activo}">
                 ${c.activo ? "Desactivar" : "Activar"}
               </button>`
            : "";

        return `
            <tr>
                <td>
                    <strong>${sanitizarTexto(c.codigo_vagon)}</strong>
                    <small class="text-muted d-block">${sanitizarTexto(c.nombre_estacion_registro)}</small>
                </td>
                <td class="small">
                    Base: ${Number(c.largo_base_cm)}×${Number(c.ancho_base_cm)} | Útil: ${Number(c.alto_util_cm)} cm<br>
                    <span class="text-muted">Sensores: ${Number(c.altura_sensor_cm)} cm</span>
                </td>
                <td><strong>${Math.round(Number(c.capacidad_util_cm3)).toLocaleString("es-MX")} cm³</strong></td>
                <td>${badgeEstado}${btnToggle}</td>
            </tr>
        `;
    }).join("");

    tbody.querySelectorAll("[data-toggle-cont]").forEach(btn => {
        btn.addEventListener("click", async () => {
            const idCont = Number(btn.dataset.toggleCont);
            const nuevoEstado = btn.dataset.estado !== "true";
            const { error } = await sb
                .from("contenedores")
                .update({ activo: nuevoEstado })
                .eq("id_contenedor", idCont);

            if (error) {
                alert("No se pudo actualizar el estado: " + error.message);
                return;
            }
            await cargarContenedores();
            recalcularSistema();
        });
    });
}

function inicializarEventosCatalogoYContenedores() {
    // Alta de material (Admin y Supervisor)
    document.getElementById("formNuevoMaterial").addEventListener("submit", async (e) => {
        e.preventDefault();
        const nombre = document.getElementById("nuevoMatNombre").value.trim();
        const suelta = parseFloat(document.getElementById("nuevoMatSuelta").value);
        const compactada = parseFloat(document.getElementById("nuevoMatComp").value);
        const uso = document.getElementById("nuevoMatUso").value.trim();

        if (!nombre || isNaN(suelta) || isNaN(compactada) || compactada < suelta) {
            alert("Verifica los valores: la densidad compactada debe ser mayor o igual a la densidad suelta.");
            return;
        }

        const { error } = await sb.from("materiales").insert({
            clave_material: crearClaveMaterial(nombre),
            nombre_material: nombre,
            densidad_suelta_gcm3: suelta,
            densidad_compactada_gcm3: compactada,
            descripcion_uso: uso
        });

        if (error) {
            alert("No se pudo registrar el material: " + error.message);
            return;
        }

        e.target.reset();
        await cargarMateriales();
        recalcularSistema();
        alert(`Material "${nombre}" guardado correctamente en la base de datos.`);
    });

    // Vista previa geométrica en el formulario de nuevo contenedor
    const actualizarPreview = () => {
        const l0 = parseFloat(document.getElementById("inputLargoBase").value) || 0;
        const w0 = parseFloat(document.getElementById("inputAnchoBase").value) || 0;
        const l1 = parseFloat(document.getElementById("inputLargoSup").value) || 0;
        const w1 = parseFloat(document.getElementById("inputAnchoSup").value) || 0;
        const hUtil = parseFloat(document.getElementById("inputAltoUtil").value) || 0;
        const hSen = parseFloat(document.getElementById("inputAltoSensor").value) || 0;
        const fac = parseFloat(document.getElementById("inputFactorCal").value) || 1;

        const cap = calcularVolumenTronco(l0, w0, l1, w1, hUtil, hUtil, fac);
        const margen = hSen - hUtil;

        document.getElementById("specAreaBase").textContent = Math.round(l0 * w0).toLocaleString("es-MX");
        document.getElementById("specAreaSup").textContent = Math.round(l1 * w1).toLocaleString("es-MX");
        document.getElementById("specCapacidadTotal").textContent = `${Math.round(cap).toLocaleString("es-MX")} cm³`;
        document.getElementById("specMargenSensor").textContent = `${margen.toFixed(1)} cm`;
    };

    ["inputLargoBase", "inputAnchoBase", "inputLargoSup", "inputAnchoSup", "inputAltoUtil", "inputAltoSensor", "inputFactorCal"]
        .forEach(id => document.getElementById(id).addEventListener("input", actualizarPreview));

    // Alta de contenedor (EXCLUSIVO Admin de estación)
    document.getElementById("formNuevoContenedor").addEventListener("submit", async (e) => {
        e.preventDefault();
        if (!perfilActual || perfilActual.clave_rol !== "admin") return;

        const codigo = document.getElementById("inputCodigoVagon").value.trim();
        const l0 = parseFloat(document.getElementById("inputLargoBase").value);
        const w0 = parseFloat(document.getElementById("inputAnchoBase").value);
        const l1 = parseFloat(document.getElementById("inputLargoSup").value);
        const w1 = parseFloat(document.getElementById("inputAnchoSup").value);
        const hUtil = parseFloat(document.getElementById("inputAltoUtil").value);
        const hSen = parseFloat(document.getElementById("inputAltoSensor").value);
        const fac = parseFloat(document.getElementById("inputFactorCal").value);

        if (l1 < l0 || w1 < w0) {
            alert("El largo y ancho a nivel útil deben ser mayores o iguales que los de la base.");
            return;
        }
        if (hSen < hUtil + 2.0) {
            alert("La altura a los sensores debe ser al menos 2.0 cm mayor que el llenado máximo (zona ciega del HC-SR04).");
            return;
        }

        const { error } = await sb.from("contenedores").insert({
            id_estacion_registro: perfilActual.id_estacion,
            codigo_vagon: codigo,
            largo_base_cm: l0,
            ancho_base_cm: w0,
            largo_sup_cm: l1,
            ancho_sup_cm: w1,
            alto_util_cm: hUtil,
            altura_sensor_cm: hSen,
            factor_calibracion: fac
        });

        if (error) {
            alert("No se pudo registrar el contenedor: " + error.message);
            return;
        }

        document.getElementById("inputCodigoVagon").value = "";
        await cargarContenedores();
        recalcularSistema();
        alert(`Contenedor "${codigo}" registrado en la base de datos y disponible en el selector.`);
    });
}