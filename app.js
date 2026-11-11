// ==========================================================================
// RAILWEIGHT - LÓGICA DE SEGURIDAD, ARREGLO LINEAL (FILA INDIA) Y CATÁLOGO
// ==========================================================================

// 1. Cuentas autorizadas para inicio de sesión seguro
const OPERADORES_AUTORIZADOS = {
    cvazquez: {
        username: "cvazquez",
        passwordHash: "Rail2026*",
        nombre: "Carlos Alfredo Vázquez Morales",
        nombreCorto: "Carlos Vázquez",
        iniciales: "CV",
        rol: "Supervisor de Calidad y Monitoreo",
        estacion: "Estación Macuspana (El Suspiro)"
    },
    hlopez: {
        username: "hlopez",
        passwordHash: "Rail2026*",
        nombre: "Heidi López Valle",
        nombreCorto: "Heidi López",
        iniciales: "HL",
        rol: "Administradora de Operaciones",
        estacion: "Estación Teapa"
    },
    adelacruz: {
        username: "adelacruz",
        passwordHash: "Rail2026*",
        nombre: "Alessandro de Jesús de la Cruz Sarao",
        nombreCorto: "Alessandro de la Cruz",
        iniciales: "AC",
        rol: "Especialista de Telemetría IoT",
        estacion: "Estación Huimanguillo"
    }
};

// 2. Catálogo dinámico de materiales a granel
let catalogoMateriales = [
    { id: "arena", nombre: "Arena Seca de Río", suelta: 1.50, compactada: 1.68, uso: "Construcción e infraestructura" },
    { id: "grava", nombre: "Grava Fina Triturada", suelta: 1.65, compactada: 1.82, uso: "Balasto ferroviario y obra civil" },
    { id: "maiz",  nombre: "Maíz Blanco a Granel", suelta: 0.75, compactada: 0.82, uso: "Carga agrícola regional" }
];

// 3. Dimensiones activas del contenedor tipo vagón alargado
let contenedorActivo = {
    codigo: "Vagón #937620",
    largo: 75.0,
    ancho: 20.0,
    alto: 25.0
};

let sesionActual = null;
let intentosFallidos = 0;
let bloqueoHasta = 0;
let tipoSuperficieActual = "Montículo Central";
let chartSensores = null;

// 4. Bitácora operativa inicial (sin columna de báscula)
let registrosMediciones = [
    {
        folio: "#101",
        fecha: "04/11/2026 09:30",
        estacionVagon: "Estación Macuspana • Vagón #937620",
        operador: "Carlos Vázquez",
        material: "Arena Seca de Río (1.50 g/cm³)",
        nivel: "56.0 %",
        volumen: "21,000 cm³",
        masaEst: "31.50 kg"
    },
    {
        folio: "#102",
        fecha: "04/11/2026 10:15",
        estacionVagon: "Estación Teapa • Vagón #937620",
        operador: "Heidi López",
        material: "Grava Fina Triturada (1.65 g/cm³)",
        nivel: "64.0 %",
        volumen: "24,000 cm³",
        masaEst: "39.60 kg"
    }
];

// Función de seguridad para sanitizar entradas de texto (previene XSS)
function sanitizarTexto(texto) {
    const div = document.createElement("div");
    div.textContent = String(texto).trim();
    return div.innerHTML;
}

document.addEventListener("DOMContentLoaded", () => {
    inicializarAutenticacion();
    inicializarMenuLateral();
    renderizarCatalogoYSelector();
    inicializarGraficaLongitudinal();
    inicializarEventosCalculo();
    inicializarFormulariosCatalogo();
    renderizarTablaRegistros();
    recalcularSistema();
});

// ================= 1. SEGURIDAD Y CONTROL DE SESIÓN =================
function inicializarAutenticacion() {
    const sesionGuardada = sessionStorage.getItem("rw_sesion_activa");
    if (sesionGuardada) {
        try {
            sesionActual = JSON.parse(sesionGuardada);
            aplicarDatosOperador(sesionActual);
            document.getElementById("loginOverlay").classList.add("hidden");
        } catch (e) {
            sessionStorage.removeItem("rw_sesion_activa");
        }
    }

    const formLogin = document.getElementById("formLogin");
    const alertBox = document.getElementById("loginAlert");

    formLogin.addEventListener("submit", (e) => {
        e.preventDefault();
        const ahora = Date.now();

        if (ahora < bloqueoHasta) {
            const segs = Math.ceil((bloqueoHasta - ahora) / 1000);
            mostrarErrorLogin(`Acceso bloqueado temporalmente por seguridad. Intenta en ${segs} segundos.`);
            return;
        }

        const user = document.getElementById("loginUsername").value.trim().toLowerCase();
        const pass = document.getElementById("loginPassword").value;

        if (OPERADORES_AUTORIZADOS[user] && OPERADORES_AUTORIZADOS[user].passwordHash === pass) {
            intentosFallidos = 0;
            alertBox.classList.add("d-none");

            sesionActual = {
                ...OPERADORES_AUTORIZADOS[user],
                horaIngreso: new Date().toLocaleString("es-MX", { dateStyle: "short", timeStyle: "short" })
            };
            sessionStorage.setItem("rw_sesion_activa", JSON.stringify(sesionActual));

            aplicarDatosOperador(sesionActual);
            document.getElementById("loginPassword").value = "";
            document.getElementById("loginOverlay").classList.add("hidden");
        } else {
            intentosFallidos++;
            if (intentosFallidos >= 3) {
                bloqueoHasta = Date.now() + 15000;
                mostrarErrorLogin("Demasiados intentos fallidos. Por seguridad se bloqueó el acceso por 15 segundos.");
            } else {
                mostrarErrorLogin("Usuario o contraseña incorrectos. Verifica tus credenciales operativas.");
            }
        }
    });

    document.getElementById("btnCerrarSesion").addEventListener("click", () => {
        sessionStorage.removeItem("rw_sesion_activa");
        sesionActual = null;
        document.getElementById("loginOverlay").classList.remove("hidden");
    });
}

function mostrarErrorLogin(mensaje) {
    const alertBox = document.getElementById("loginAlert");
    alertBox.textContent = mensaje;
    alertBox.classList.remove("d-none");
}

function aplicarDatosOperador(operador) {
    document.getElementById("sidebarAvatar").textContent = operador.iniciales;
    document.getElementById("sidebarUserName").textContent = operador.nombreCorto;
    document.getElementById("sidebarUserStation").textContent = operador.estacion;
    document.getElementById("headerStationText").textContent = operador.estacion;

    document.getElementById("profileBigAvatar").textContent = operador.iniciales;
    document.getElementById("profileName").textContent = operador.nombre;
    document.getElementById("profileRole").textContent = operador.rol;
    document.getElementById("profileUsername").textContent = operador.username;
    document.getElementById("profileStation").textContent = operador.estacion;
    document.getElementById("profileLoginTime").textContent = operador.horaIngreso;
}

// ================= 2. MENÚ LATERAL Y PESTAÑAS =================
function inicializarMenuLateral() {
    const layout = document.getElementById("appLayout");
    const btnToggle = document.getElementById("btnToggleSidebar");
    const links = document.querySelectorAll(".rw-nav-link");
    const panes = document.querySelectorAll(".rw-tab-pane");

    const titulosPestanas = {
        "tab-calculo": ["Cálculo de Masa y Monitoreo Longitudinal", "Estimación volumétrica mediante arreglo lineal de 5 sensores ultrasónicos"],
        "tab-registros": ["Historial de Registros de Pesaje", "Bitácora operativa de estimaciones por vagón y estación"],
        "tab-catalogo": ["Catálogo de Materiales y Dimensiones del Vagón", "Administración de densidades aparentes y geometría física del contenedor"],
        "tab-conexion": ["Conexión ESP32 y Seguridad de Red", "Configuración del enlace inalámbrico IoT y estado del servidor"],
        "tab-perfil": ["Perfil del Operador Autenticado", "Información de la sesión activa y credenciales de seguridad"]
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
    }

    links.forEach(link => {
        link.addEventListener("click", () => activarPestana(link.dataset.tab));
    });

    document.getElementById("sidebarUserCard").addEventListener("click", () => {
        activarPestana("tab-perfil");
    });
}

// ================= 3. GRÁFICA DE CORTE LONGITUDINAL (FILA INDIA) =================
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
                data: [12.0, 14.5, 17.0, 14.0, 11.5],
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
                    max: contenedorActivo.alto,
                    title: { display: true, text: "Altura de carga (cm)" }
                }
            }
        }
    });
}

// ================= 4. CÁLCULO POR REGLA DEL TRAPECIO (5 EN FILA) =================
function recalcularSistema() {
    const matId = document.getElementById("selectMaterial").value;
    const estadoKey = document.getElementById("selectEstadoMaterial").value;
    const materialObj = catalogoMateriales.find(m => m.id === matId) || catalogoMateriales[0];

    const densidad = materialObj[estadoKey];
    document.getElementById("inputDensidad").value = densidad.toFixed(2);

    const { largo, ancho, alto } = contenedorActivo;

    // Obtener las 5 alturas en fila india: h_i = AltoTotal - d_i
    const ids = ["d1", "d2", "d3", "d4", "d5"];
    const alturas = ids.map((id, index) => {
        const inputEl = document.getElementById(id);
        let d = parseFloat(inputEl.value);
        if (isNaN(d) || d < 0) d = 0;
        if (d > alto) d = alto;

        const h = Math.max(0, alto - d);
        document.getElementById(`h${index + 1}`).textContent = `${h.toFixed(1)} cm`;
        return h;
    });

    // Regla del Trapecio Compuesta para 5 puntos longitudinales equidistantes
    const alturaPromedioTrapecio = (alturas[0] + 2 * alturas[1] + 2 * alturas[2] + 2 * alturas[3] + alturas[4]) / 8;

    const capacidadMaxCm3 = largo * ancho * alto;
    const volumenOcupadoCm3 = largo * ancho * alturaPromedioTrapecio;
    const nivelPct = capacidadMaxCm3 > 0 ? (volumenOcupadoCm3 / capacidadMaxCm3) * 100 : 0;

    const masaGramos = volumenOcupadoCm3 * densidad;
    const masaKg = masaGramos / 1000;

    // Actualizar Banner Principal
    document.getElementById("resMasaKg").textContent = masaKg.toFixed(2);
    document.getElementById("resMasaGramos").textContent = `(${Math.round(masaGramos).toLocaleString("es-MX")} g)`;
    document.getElementById("resMaterialNombre").textContent = materialObj.nombre;
    document.getElementById("resDensidadVal").textContent = `${densidad.toFixed(2)} g/cm³`;
    document.getElementById("resVolumenCm3").textContent = `${Math.round(volumenOcupadoCm3).toLocaleString("es-MX")} cm³`;
    document.getElementById("resCapMax").textContent = `${Math.round(capacidadMaxCm3).toLocaleString("es-MX")} cm³`;
    document.getElementById("resNivelPct").textContent = `${nivelPct.toFixed(1)} %`;
    document.getElementById("resAlturaProm").textContent = `${alturaPromedioTrapecio.toFixed(1)} cm`;
    document.getElementById("resTipoSuperficie").textContent = `Distribución: ${tipoSuperficieActual}`;

    // Actualizar resumen del vagón activo
    document.getElementById("badgeCodigoVagon").textContent = contenedorActivo.codigo;
    document.getElementById("lblLargoActivo").textContent = `${largo} cm`;
    document.getElementById("lblAnchoActivo").textContent = `${ancho} cm`;
    document.getElementById("lblAltoActivo").textContent = `${alto} cm`;

    if (chartSensores) {
        chartSensores.options.scales.y.max = alto;
        chartSensores.data.datasets[0].data = alturas;
        chartSensores.update();
    }
}

// ================= 5. EVENTOS DE OPERACIÓN Y BITÁCORA =================
function inicializarEventosCalculo() {
    const inputs = ["selectMaterial", "selectEstadoMaterial", "d1", "d2", "d3", "d4", "d5"];
    inputs.forEach(id => {
        document.getElementById(id).addEventListener("input", recalcularSistema);
    });

    // Botones de simulación de perfil longitudinal
    document.querySelectorAll("[data-preset]").forEach(btn => {
        btn.addEventListener("click", () => {
            document.querySelectorAll("[data-preset]").forEach(b => b.classList.remove("active"));
            btn.classList.add("active");

            const alto = contenedorActivo.alto;
            const preset = btn.dataset.preset;
            if (preset === "plana") {
                const dPlano = (alto * 0.45).toFixed(1);
                setDistancias(dPlano, dPlano, dPlano, dPlano, dPlano, "Carga Plana");
            } else if (preset === "monticulo") {
                setDistancias(
                    (alto * 0.52).toFixed(1),
                    (alto * 0.42).toFixed(1),
                    (alto * 0.32).toFixed(1),
                    (alto * 0.44).toFixed(1),
                    (alto * 0.54).toFixed(1),
                    "Montículo Central"
                );
            } else if (preset === "inclinada") {
                setDistancias(
                    (alto * 0.30).toFixed(1),
                    (alto * 0.38).toFixed(1),
                    (alto * 0.46).toFixed(1),
                    (alto * 0.54).toFixed(1),
                    (alto * 0.62).toFixed(1),
                    "Carga Inclinada"
                );
            }
        });
    });

    // Botón de actualizar lectura
    document.getElementById("btnQuickSim").addEventListener("click", () => {
        const alto = contenedorActivo.alto;
        const v = () => (Math.random() * 1.0 - 0.5);
        setDistancias(
            Math.max(2, alto * 0.50 + v()).toFixed(1),
            Math.max(2, alto * 0.40 + v()).toFixed(1),
            Math.max(2, alto * 0.32 + v()).toFixed(1),
            Math.max(2, alto * 0.42 + v()).toFixed(1),
            Math.max(2, alto * 0.52 + v()).toFixed(1),
            "Lectura de Sensores"
        );
    });

    // Guardar directamente en el historial
    document.getElementById("btnGuardarDirecto").addEventListener("click", () => {
        const nuevoFolio = `#${101 + registrosMediciones.length}`;
        const ahora = new Date().toLocaleString("es-MX", { dateStyle: "short", timeStyle: "short" });
        const operador = sesionActual ? sesionActual.nombreCorto : "Carlos Vázquez";
        const estacion = sesionActual ? sesionActual.estacion : "Estación Macuspana";
        const matNombre = document.getElementById("resMaterialNombre").textContent;
        const dens = document.getElementById("inputDensidad").value;

        registrosMediciones.unshift({
            folio: nuevoFolio,
            fecha: ahora,
            estacionVagon: `${estacion} • ${contenedorActivo.codigo}`,
            operador: operador,
            material: `${matNombre} (${dens} g/cm³)`,
            nivel: document.getElementById("resNivelPct").textContent,
            volumen: document.getElementById("resVolumenCm3").textContent,
            masaEst: `${document.getElementById("resMasaKg").textContent} kg`
        });

        renderizarTablaRegistros();
        alert("Estimación registrada correctamente en el Historial.");
    });

    // Exportar CSV
    document.getElementById("btnExportarCSV").addEventListener("click", () => {
        let csv = "Folio,Fecha y Hora,Estacion y Vagon,Operador,Material,Nivel de Llenado,Volumen Ocupado,Masa Estimada\n";
        registrosMediciones.forEach(r => {
            csv += `"${r.folio}","${r.fecha}","${r.estacionVagon}","${r.operador}","${r.material}","${r.nivel}","${r.volumen}","${r.masaEst}"\n`;
        });
        const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
        const link = document.createElement("a");
        link.href = URL.createObjectURL(blob);
        link.download = "Bitacora_RailWeight.csv";
        link.click();
    });
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

function renderizarTablaRegistros() {
    const tbody = document.getElementById("tablaRegistrosBody");
    tbody.innerHTML = registrosMediciones.map(r => `
        <tr>
            <td><strong>${sanitizarTexto(r.folio)}</strong></td>
            <td>${sanitizarTexto(r.fecha)}</td>
            <td>${sanitizarTexto(r.estacionVagon)}</td>
            <td>${sanitizarTexto(r.operador)}</td>
            <td>${sanitizarTexto(r.material)}</td>
            <td><span class="badge bg-success-subtle text-success border border-success-subtle">${sanitizarTexto(r.nivel)}</span></td>
            <td>${sanitizarTexto(r.volumen)}</td>
            <td><strong class="text-dark">${sanitizarTexto(r.masaEst)}</strong></td>
        </tr>
    `).join("");
}

// ================= 6. GESTIÓN DE CATÁLOGO Y DIMENSIONES DEL VAGÓN =================
function renderizarCatalogoYSelector() {
    const selectMat = document.getElementById("selectMaterial");
    const valorPrevio = selectMat.value;

    selectMat.innerHTML = catalogoMateriales.map(m =>
        `<option value="${sanitizarTexto(m.id)}">${sanitizarTexto(m.nombre)}</option>`
    ).join("");

    if (valorPrevio && catalogoMateriales.some(m => m.id === valorPrevio)) {
        selectMat.value = valorPrevio;
    }

    const tbodyCat = document.getElementById("tablaCatalogoBody");
    tbodyCat.innerHTML = catalogoMateriales.map(m => `
        <tr>
            <td><strong>${sanitizarTexto(m.nombre)}</strong></td>
            <td>${m.suelta.toFixed(2)} g/cm³ (${Math.round(m.suelta * 1000).toLocaleString("es-MX")} kg/m³)</td>
            <td>${m.compactada.toFixed(2)} g/cm³ (${Math.round(m.compactada * 1000).toLocaleString("es-MX")} kg/m³)</td>
            <td>${sanitizarTexto(m.uso)}</td>
        </tr>
    `).join("");
}

function inicializarFormulariosCatalogo() {
    // Formulario para añadir nuevo material
    document.getElementById("formNuevoMaterial").addEventListener("submit", (e) => {
        e.preventDefault();
        const nombre = sanitizarTexto(document.getElementById("nuevoMatNombre").value);
        const suelta = parseFloat(document.getElementById("nuevoMatSuelta").value);
        const compactada = parseFloat(document.getElementById("nuevoMatComp").value);
        const uso = sanitizarTexto(document.getElementById("nuevoMatUso").value);

        if (!nombre || isNaN(suelta) || isNaN(compactada) || suelta <= 0 || compactada <= 0) {
            alert("Por favor ingresa valores válidos para el material.");
            return;
        }

        const nuevoId = "mat_" + Date.now();
        catalogoMateriales.push({
            id: nuevoId,
            nombre: nombre,
            suelta: suelta,
            compactada: compactada,
            uso: uso
        });

        renderizarCatalogoYSelector();
        document.getElementById("selectMaterial").value = nuevoId;
        recalcularSistema();
        e.target.reset();
        alert(`Material "${nombre}" añadido al catálogo y disponible en el selector.`);
    });

    // Formulario para modificar dimensiones del contenedor
    const actualizarVistaPreviaDimensiones = () => {
        const l = parseFloat(document.getElementById("inputLargo").value) || 0;
        const w = parseFloat(document.getElementById("inputAncho").value) || 0;
        const h = parseFloat(document.getElementById("inputAlto").value) || 0;
        const area = l * w;
        const cap = area * h;
        const sep = l / 5;

        document.getElementById("specAreaBase").textContent = `${Math.round(area).toLocaleString("es-MX")} cm²`;
        document.getElementById("specCapacidadTotal").textContent = `${Math.round(cap).toLocaleString("es-MX")} cm³`;
        document.getElementById("specSeparacionSensores").textContent = `${sep.toFixed(1)} cm entre cada sensor`;
    };

    ["inputLargo", "inputAncho", "inputAlto"].forEach(id => {
        document.getElementById(id).addEventListener("input", actualizarVistaPreviaDimensiones);
    });

    document.getElementById("formDimensionesContenedor").addEventListener("submit", (e) => {
        e.preventDefault();
        const codigo = sanitizarTexto(document.getElementById("inputCodigoVagon").value);
        const largo = parseFloat(document.getElementById("inputLargo").value);
        const ancho = parseFloat(document.getElementById("inputAncho").value);
        const alto = parseFloat(document.getElementById("inputAlto").value);

        if (largo < 10 || ancho < 5 || alto < 5) {
            alert("Verifica que las dimensiones del contenedor sean mayores al mínimo permitido.");
            return;
        }

        contenedorActivo = { codigo, largo, ancho, alto };

        // Ajustar el máximo permitido en los inputs de distancia según el nuevo alto
        ["d1", "d2", "d3", "d4", "d5"].forEach(id => {
            const el = document.getElementById(id);
            el.max = alto;
            if (parseFloat(el.value) > alto) {
                el.value = (alto * 0.5).toFixed(1);
            }
        });

        actualizarVistaPreviaDimensiones();
        recalcularSistema();
        alert("Dimensiones del contenedor actualizadas correctamente en todo el sistema.");
    });
}