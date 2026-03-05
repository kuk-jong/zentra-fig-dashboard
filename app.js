// Authentication for dashboard UI
const AUTH_PASSWORD = '1234';

// Login Elements
const loginOverlay = document.getElementById('loginOverlay');
const dashboardContent = document.getElementById('dashboardContent');
const passwordInput = document.getElementById('passwordInput');
const loginBtn = document.getElementById('loginBtn');
const loginError = document.getElementById('loginError');

// DOM Elements
const dSelect = document.getElementById('deviceSelect');
const btnApply = document.getElementById('applyFilterBtn');
const mobileNavToggle = document.getElementById('mobileNavToggle');
const sidebar = document.querySelector('.sidebar');

fetchWeather(); // Fetch weather on load

if (mobileNavToggle) {
    mobileNavToggle.addEventListener('click', () => {
        sidebar.classList.toggle('active');
    });
}

const els = {
    MaxTemp: document.getElementById('valMaxTemp'),
    MinTemp: document.getElementById('valMinTemp'),
    Temp: document.getElementById('valTemp'),
    Hum: document.getElementById('valHum'),
    Solar: document.getElementById('valSolar'),
    Ppfd: document.getElementById('valPpfd'),
    Water: document.getElementById('valWater'),
    SoilTemp: document.getElementById('valSoilTemp'),
    EC: document.getElementById('valEC'),
    VPD: document.getElementById('valVPD'),
    Battery: document.getElementById('valBattery')
};

const loadingOverlay = document.getElementById('loadingOverlay');
const loadingMsg = document.getElementById('loadingMsg');
const connStatus = document.getElementById('connStatus');
const progressContainer = document.getElementById('progressContainer');
const progressBar = document.getElementById('progressBar');

let chartTempHum = null;
let chartSolar = null;

// Realtime Data Storage
const dataHistory = {
    labels: [],
    temp: [],
    hum: [],
    soilTemp: [],
    waterContent: [],
    solar: [],
    ppfd: []
};

// Max points to keep in chart memory (48 hours * 12 = 576, round to 600)
const MAX_DATA_POINTS = 600;

let pollingTimer = null;

function calculateRH(t, vpd) {
    if (t === null || vpd === null || t === undefined || vpd === undefined) return null;
    const es = 0.611 * Math.exp((17.502 * t) / (t + 240.97)); // Saturation Vapor Pressure (kPa)
    const ea = es - vpd; // Actual Vapor Pressure (ea) = Saturation Vapor Pressure (es) - Vapor Pressure Deficit (VPD)
    return Math.min(Math.max((ea / es) * 100, 0), 100);
}

function handleLogin() {
    if (passwordInput.value === AUTH_PASSWORD) {
        loginOverlay.style.display = 'none';
        dashboardContent.style.display = 'flex';

        loadingOverlay.style.display = 'none';

        // Start polling immediately upon login
        startRealtimePolling();
    } else {
        loginError.style.display = 'block';
        passwordInput.value = '';
    }
}

loginBtn.addEventListener('click', handleLogin);
passwordInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') handleLogin();
});

dSelect.addEventListener('change', () => {
    dataHistory.labels = [];
    dataHistory.temp = [];
    dataHistory.hum = [];
    dataHistory.soilTemp = [];
    dataHistory.waterContent = [];
    dataHistory.solar = [];
    dataHistory.ppfd = [];
    todayMaxTemp = { val: -999, ts: null };
    todayMinTemp = { val: 999, ts: null };

    fetchRealtimeData(true);
    fetchWeather(); // Update weather when region changes

    // Auto-hide sidebar on mobile after selecting a device
    if (window.innerWidth <= 900 && sidebar.classList.contains('active')) {
        sidebar.classList.remove('active');
    }
});

// Chart Filter States
const chartFilters = {
    chart1: { start: null, end: null },
    chart2: { start: null, end: null }
};

// Weather Fetching Logic (Open-Meteo API)
const WEATHER_COORDS = {
    "z6-23134": { lat: 34.57, lon: 126.60 }, // Haenam approximate
    "z6-23133": { lat: 34.80, lon: 126.70 }  // Yeongam approximate
};

const WEATHER_CODES = {
    0: { desc: "맑음", icon: "☀️" },
    1: { desc: "대체로 맑음", icon: "🌤️" },
    2: { desc: "구름조금", icon: "⛅" },
    3: { desc: "흐림", icon: "☁️" },
    45: { desc: "안개", icon: "🌫️" },
    48: { desc: "짙은 안개", icon: "🌫️" },
    51: { desc: "가벼운 이슬비", icon: "🌦️" },
    53: { desc: "이슬비", icon: "🌧️" },
    55: { desc: "강한 이슬비", icon: "🌧️" },
    61: { desc: "가벼운 비", icon: "🌦️" },
    63: { desc: "비", icon: "🌧️" },
    65: { desc: "강한 비", icon: "⛈️" },
    71: { desc: "가벼운 눈", icon: "🌨️" },
    73: { desc: "눈", icon: "❄️" },
    75: { desc: "강한 눈", icon: "❄️" },
    95: { desc: "천둥번개", icon: "⛈️" }
};

async function fetchWeather() {
    const deviceId = dSelect.value;
    const coords = WEATHER_COORDS[deviceId];

    if (!coords) return;

    try {
        const url = `https://api.open-meteo.com/v1/forecast?latitude=${coords.lat}&longitude=${coords.lon}&current=temperature_2m,relative_humidity_2m,weather_code&timezone=Asia%2FTokyo`;
        const res = await fetch(url);
        if (!res.ok) throw new Error("Weather fetch failed");

        const data = await res.json();
        const current = data.current;

        const codeInfo = WEATHER_CODES[current.weather_code] || { desc: "알 수 없음", icon: "❓" };

        document.getElementById('weatherTemp').textContent = `${current.temperature_2m.toFixed(1)}°C`;
        document.getElementById('weatherHum').textContent = current.relative_humidity_2m;
        document.getElementById('weatherDesc').textContent = codeInfo.desc;
        document.getElementById('weatherIcon').textContent = codeInfo.icon;

    } catch (error) {
        console.error("Failed to load weather:", error);
        document.getElementById('weatherDesc').textContent = "날씨 로딩 실패";
    }
}

function getFilteredData(dataArray, filterState) {
    if (!filterState.start || !filterState.end) return dataArray;
    const s = new Date(filterState.start + 'T00:00:00').getTime();
    const e = new Date(filterState.end + 'T23:59:59').getTime();
    return dataArray.filter(pt => {
        const t = pt.x.getTime();
        return t >= s && t <= e;
    });
}

function updateChartStats(ci, statElementId) {
    if (!ci) return;
    let html = '';
    ci.data.datasets.forEach((ds, i) => {
        const meta = ci.getDatasetMeta(i);
        if (!meta.hidden && ds.data.length > 0) {
            let sum = 0, min = Infinity, max = -Infinity;
            ds.data.forEach(pt => {
                sum += pt.y;
                if (pt.y > max) max = pt.y;
                if (pt.y < min) min = pt.y;
            });
            const avg = sum / ds.data.length;
            html += `<div style="display:inline-block; border-left: 3px solid ${ds.borderColor}; padding-left: 5px;">
                       <strong style="color:${ds.borderColor}">${ds.label}</strong><br>
                       최고: ${max.toFixed(1)} | 최저: ${min.toFixed(1)} | 평균: ${avg.toFixed(1)}
                     </div>`;
        }
    });

    const el = document.getElementById(statElementId);
    if (html === '') {
        el.innerHTML = '<span style="color:var(--text-secondary);">표시 기간 대표값: 데이터 없음</span>';
    } else {
        el.innerHTML = html;
    }
}

function startRealtimePolling() {
    connStatus.innerHTML = '<span class="status-dot"></span> Polling Local...';
    connStatus.style.color = '#1dd1a1';

    // Fetch immediately with full history
    fetchRealtimeData(true);

    // Then every 10 minutes (600,000 ms) to match GitHub actions interval
    if (pollingTimer) clearInterval(pollingTimer);
    pollingTimer = setInterval(() => fetchRealtimeData(false), 600000);
}

async function fetchRealtimeData(fetchAll = false) {
    try {
        // Fetch static JSON generated by GitHub Actions
        const url = `data.json?t=${new Date().getTime()}`;
        const res = await fetch(url);
        if (!res.ok) throw new Error('Data file not found');

        const allData = await res.json();
        const readings = allData[dSelect.value] || [];

        // Clear existing data so we can redraw the full history from the static JSON file
        dataHistory.labels = [];
        dataHistory.temp = [];
        dataHistory.hum = [];
        dataHistory.soilTemp = [];
        dataHistory.waterContent = [];
        dataHistory.solar = [];
        dataHistory.ppfd = [];
        todayMaxTemp = { val: -999, ts: null };
        todayMinTemp = { val: 999, ts: null };

        readings.forEach(r => processDataPoint(r));
        renderCharts();

        connStatus.innerHTML = '<span class="status-dot"></span> Live (GitHub)';
        connStatus.style.color = '#1dd1a1';

    } catch (err) {
        console.error("Polling error:", err);
        connStatus.innerHTML = '<span class="status-dot" style="background:#ff6b6b;box-shadow:0 0 10px #ff6b6b;"></span> Offline';
        connStatus.style.color = '#ff6b6b';
        document.getElementById('lastUpdated').textContent = `통신 실패 (데이터 로딩 대기중)`;
    }
}

let todayMaxTemp = { val: -999, ts: null };
let todayMinTemp = { val: 999, ts: null };

function processDataPoint(payload) {
    const ts = new Date(payload.timestamp_utc * 1000);
    const dtStr = payload.datetime;
    const d = payload.data;

    document.getElementById('lastUpdated').textContent = `마지막 수신: ${dtStr}`;
    document.getElementById('pageTitle').textContent = `${dSelect.options[dSelect.selectedIndex].text} (로컬 실시간 모니터링)`;

    // Process single data point
    const rh = calculateRH(d.temperature, d.vpd); // simplified dummy logic for RH
    const ppfd = d.solar !== undefined ? d.solar * 2.1 : undefined;

    // Check if the data point is from TODAY (local time)
    const todayStr = new Date().toLocaleDateString();
    const pointDateStr = ts.toLocaleDateString();
    const isToday = (todayStr === pointDateStr);

    // Track min/max strictly for TODAY
    if (isToday) {
        if (d.temperature > todayMaxTemp.val) todayMaxTemp = { val: d.temperature, ts: dtStr };
        if (d.temperature < todayMinTemp.val || todayMinTemp.val === 999) todayMinTemp = { val: d.temperature, ts: dtStr };
    }

    // Update KPIs
    updateKpi(els.MaxTemp, todayMaxTemp, false, 1);
    updateKpi(els.MinTemp, todayMinTemp, false, 1);
    updateKpi(els.Temp, { val: d.temperature, ts: dtStr }, false, 1);
    updateKpi(els.Hum, { val: rh || d.humidity, ts: dtStr }, false, 1); // fallback to raw humidity
    updateKpi(els.Solar, { val: d.solar, ts: dtStr }, true);
    updateKpi(els.Ppfd, { val: ppfd, ts: dtStr }, true);
    updateKpi(els.Water, { val: d.water_content, ts: dtStr }, false, 3);
    updateKpi(els.SoilTemp, { val: d.soil_temp, ts: dtStr }, false, 1);
    updateKpi(els.EC, { val: d.ec, ts: dtStr }, false, 2);
    updateKpi(els.VPD, { val: d.vpd, ts: dtStr }, false, 2);
    updateKpi(els.Battery, { val: d.battery, ts: dtStr }, true);

    // Update Chart History
    dataHistory.labels.push(ts);
    dataHistory.temp.push({ x: ts, y: d.temperature });
    dataHistory.hum.push({ x: ts, y: rh || d.humidity });
    dataHistory.soilTemp.push({ x: ts, y: d.soil_temp });
    dataHistory.waterContent.push({ x: ts, y: d.water_content * 100 });
    dataHistory.solar.push({ x: ts, y: d.solar });
    dataHistory.ppfd.push({ x: ts, y: ppfd });

    if (dataHistory.labels.length > MAX_DATA_POINTS) {
        dataHistory.labels.shift();
        dataHistory.temp.shift();
        dataHistory.hum.shift();
        dataHistory.soilTemp.shift();
        dataHistory.waterContent.shift();
        dataHistory.solar.shift();
        dataHistory.ppfd.shift();
    }
}

const updateKpi = (el, dataObj, isRound, dec) => {
    if (dataObj && dataObj.val !== undefined && dataObj.val !== -999 && dataObj.val !== 999) {
        const v = isRound ? Math.round(dataObj.val) : dataObj.val.toFixed(dec);
        el.innerHTML = `${v} <span style="font-size:0.4em; display:block; color:#9a9cae; margin-top:5px; font-weight:normal;">최근: ${dataObj.ts}</span>`;
    } else {
        el.innerHTML = '--';
    }
};

function renderCharts() {
    Chart.defaults.color = '#9a9cae';
    Chart.defaults.font.family = "'Outfit', sans-serif";
    Chart.defaults.elements.point.radius = 2;
    Chart.defaults.elements.line.tension = 0.2;
    Chart.defaults.elements.line.borderWidth = 1.5; // Thinner lines

    const commonScaleX = {
        type: 'time',
        time: { unit: 'minute', displayFormats: { minute: 'HH:mm' } },
        grid: { color: 'rgba(255,255,255,0.05)' }
    };

    if (!chartTempHum) {
        const ctx1 = document.getElementById('tempHumChart').getContext('2d');
        chartTempHum = new Chart(ctx1, {
            type: 'line',
            data: {
                datasets: [
                    { label: '기온 (°C)', data: getFilteredData(dataHistory.temp, chartFilters.chart1), borderColor: '#ff6b6b', yAxisID: 'y' },
                    { label: '상대습도 (%)', data: getFilteredData(dataHistory.hum, chartFilters.chart1), borderColor: '#48dbfb', yAxisID: 'y1' },
                    { label: '토양온도 (°C)', data: getFilteredData(dataHistory.soilTemp, chartFilters.chart1), borderColor: '#e1b12c', yAxisID: 'y' },
                    { label: '토양습도 (%)', data: getFilteredData(dataHistory.waterContent, chartFilters.chart1), borderColor: '#a55eea', yAxisID: 'y1' }
                ]
            },
            options: {
                responsive: true, maintainAspectRatio: false,
                animation: false, // Turn off animation for faster realtime updates
                interaction: { mode: 'index', intersect: false },
                scales: {
                    x: commonScaleX,
                    y: { type: 'linear', position: 'left', grid: { color: 'rgba(255,255,255,0.05)' } },
                    y1: { type: 'linear', position: 'right', min: 0, max: 100, grid: { drawOnChartArea: false } }
                },
                plugins: {
                    legend: {
                        position: 'top',
                        labels: { usePointStyle: true, boxWidth: 8 },
                        onClick: function (e, legendItem, legend) {
                            const index = legendItem.datasetIndex;
                            const ci = legend.chart;
                            if (ci.isDatasetVisible(index)) { ci.hide(index); } else { ci.show(index); }
                            ci.update();
                            setTimeout(() => updateChartStats(chartTempHum, 'statsChart1'), 50);
                        }
                    }
                }
            }
        });
    } else {
        chartTempHum.data.datasets[0].data = getFilteredData(dataHistory.temp, chartFilters.chart1);
        chartTempHum.data.datasets[1].data = getFilteredData(dataHistory.hum, chartFilters.chart1);
        chartTempHum.data.datasets[2].data = getFilteredData(dataHistory.soilTemp, chartFilters.chart1);
        chartTempHum.data.datasets[3].data = getFilteredData(dataHistory.waterContent, chartFilters.chart1);
        chartTempHum.update();
    }
    updateChartStats(chartTempHum, 'statsChart1');

    if (!chartSolar) {
        const ctx2 = document.getElementById('solarChart').getContext('2d');
        chartSolar = new Chart(ctx2, {
            type: 'line',
            data: {
                datasets: [
                    { label: '일사량 (W/m²)', data: getFilteredData(dataHistory.solar, chartFilters.chart2), borderColor: '#feca57', backgroundColor: 'rgba(254, 202, 87, 0.1)', fill: true, yAxisID: 'y' },
                    { label: 'PPFD (µmol/m²/s)', data: getFilteredData(dataHistory.ppfd, chartFilters.chart2), borderColor: '#1dd1a1', yAxisID: 'y1' }
                ]
            },
            options: {
                responsive: true, maintainAspectRatio: false,
                animation: false,
                interaction: { mode: 'index', intersect: false },
                scales: {
                    x: commonScaleX,
                    y: { type: 'linear', position: 'left', grid: { color: 'rgba(255,255,255,0.05)' } },
                    y1: { type: 'linear', position: 'right', grid: { drawOnChartArea: false } }
                },
                plugins: {
                    legend: {
                        position: 'top',
                        labels: { usePointStyle: true, boxWidth: 8 },
                        onClick: function (e, legendItem, legend) {
                            const index = legendItem.datasetIndex;
                            const ci = legend.chart;
                            if (ci.isDatasetVisible(index)) { ci.hide(index); } else { ci.show(index); }
                            ci.update();
                            setTimeout(() => updateChartStats(chartSolar, 'statsChart2'), 50);
                        }
                    }
                }
            }
        });
    } else {
        chartSolar.data.datasets[0].data = getFilteredData(dataHistory.solar, chartFilters.chart2);
        chartSolar.data.datasets[1].data = getFilteredData(dataHistory.ppfd, chartFilters.chart2);
        chartSolar.update();
    }
    updateChartStats(chartSolar, 'statsChart2');
}

// Modal Logic for Download via Local Server
const modal = document.getElementById('downloadModal');
document.getElementById('navDownload').addEventListener('click', (e) => {
    e.preventDefault();
    modal.style.display = 'flex';
});

document.getElementById('closeModalBtn').addEventListener('click', () => {
    modal.style.display = 'none';
});

document.getElementById('executeDownloadBtn').addEventListener('click', () => {
    const statusText = document.getElementById('downloadStatus');
    const deviceId = dSelect.value;

    statusText.textContent = "가장 최근 생성된 아카이브 파일을 다운로드합니다...";

    try {
        const url = `archive_${deviceId}.csv`;
        const link = document.createElement("a");
        link.setAttribute("href", url);
        link.setAttribute("download", `ZentraCloud_FullArchive_${deviceId}.csv`);

        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);

        statusText.textContent = `✅ 무제한 누적 창고 다운로드 시작!`;
    } catch (e) {
        console.error(e);
        statusText.textContent = "❌ 다운로드 연결 실패.";
    }
});

function dtToISOKorean(dt) {
    const pad = n => n < 10 ? '0' + n : n;
    return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())} ${pad(dt.getHours())}:${pad(dt.getMinutes())}:${pad(dt.getSeconds())}`;
}

// Init Filter Pickers and Buttons
document.addEventListener('DOMContentLoaded', () => {
    flatpickr(".chart-date-filter", { dateFormat: "Y-m-d", allowInput: true });

    document.getElementById('btnFilterChart1').addEventListener('click', () => {
        chartFilters.chart1.start = document.getElementById('chart1Start').value;
        chartFilters.chart1.end = document.getElementById('chart1End').value;
        renderCharts();
    });

    document.getElementById('btnFilterChart2').addEventListener('click', () => {
        chartFilters.chart2.start = document.getElementById('chart2Start').value;
        chartFilters.chart2.end = document.getElementById('chart2End').value;
        renderCharts();
    });
});
