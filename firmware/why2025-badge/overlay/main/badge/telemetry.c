// telemetry: Wi-Fi STA + MQTT + invio periodico nel formato napoli/ (vedi telemetry.h).
//
// Un solo task ("telemetry") fa tutto il lavoro che tocca rete e sensori: gli handler degli
// eventi (Wi-Fi, IP, MQTT) aggiornano solo dei flag e svegliano il task con una notifica.
// La riconnessione MQTT è quella di ESP-MQTT (reconnect_timeout_ms); quella Wi-Fi è qui,
// con attesa esponenziale da 2 a 30 s.

#include "telemetry.h"

#include <inttypes.h>
#include <math.h>
#include <stdarg.h>
#include <stdio.h>
#include <string.h>

#include "badge.h"  // badge_obj (MAC), count_ble_nodes()
#include "cJSON.h"
#include "contapersone.h"
#include "esp_crt_bundle.h"
#include "esp_event.h"
#include "esp_log.h"
#include "esp_netif.h"
#include "esp_system.h"
#include "esp_timer.h"
#include "esp_wifi.h"
#include "esp_wpa2.h"
#include "freertos/FreeRTOS.h"
#include "freertos/semphr.h"
#include "freertos/task.h"
#include "mqtt_client.h"
#include "payload.h"

static const char *TAG = "telemetry";

// Bit delle notifiche al task
#define N_MQTT_CONNECTED (1u << 0)
#define N_PIU (1u << 1)
#define N_SEND_NOW (1u << 2)
#define N_WAKE (1u << 3)
#define N_AZZERA (1u << 4)
#define N_ZONA (1u << 5)

#define JSON_BUF 320   // stato del badge ~230 byte, una lettura ~60
#define TOPIC_BUF 112  // "napoli/sensori/" + id (max 64) + "/" + grandezza

static TaskHandle_t task_handle;
static SemaphoreHandle_t snap_mutex;
static telemetry_snapshot_t snap;

static esp_mqtt_client_handle_t mqtt;
static volatile bool owner = false;      // la connessione STA l'ha aperta la telemetria
static volatile bool got_ip = false;
static volatile bool mqtt_connected = false;
static bool mqtt_started = false;
static volatile int interval_s = TELEMETRY_INTERVAL_S;

static char device_id[65];
static char zona[32];         // usata solo dal task della telemetria
static char zona_nuova[32];   // scritta dal comando {"zona":...}, protetta da snap_mutex
static char topic_stato[TOPIC_BUF], topic_cmd[TOPIC_BUF];
static char uri[160];
static contapersone_t persone;  // usato solo dal task della telemetria

// ------------------------------------------------------------------ stato condiviso con la UI

static void snap_lock(void) { xSemaphoreTake(snap_mutex, portMAX_DELAY); }
static void snap_unlock(void) { xSemaphoreGive(snap_mutex); }

static void set_state(telemetry_state_t s) {
    snap_lock();
    snap.state = s;
    snap_unlock();
}

static void set_error(const char *fmt, ...) __attribute__((format(printf, 1, 2)));
static void set_error(const char *fmt, ...) {
    va_list ap;
    va_start(ap, fmt);
    snap_lock();
    vsnprintf(snap.last_error, sizeof(snap.last_error), fmt, ap);
    snap_unlock();
    va_end(ap);
}

static void set_message(const char *text) {
    snap_lock();
    strlcpy(snap.message, text, sizeof(snap.message));
    snap_unlock();
}

void telemetry_get_snapshot(telemetry_snapshot_t *out) {
    if (!snap_mutex) {
        memset(out, 0, sizeof(*out));
        return;
    }
    snap_lock();
    *out = snap;
    snap_unlock();
}

bool telemetry_enabled(void) { return TELEMETRY_ENABLED && strlen(TELEMETRY_WIFI_SSID) > 0; }
bool telemetry_owns_sta(void) { return owner; }
bool telemetry_wants_heap(void) { return telemetry_enabled() && !TELEMETRY_KEEP_SCHEDULE; }
bool telemetry_ble_disabled(void) { return telemetry_enabled() && TELEMETRY_DISABLE_BLE; }

static void notify(uint32_t bits) {
    if (task_handle) xTaskNotify(task_handle, bits, eSetBits);
}

void telemetry_persone_piu(void) { notify(N_PIU); }
void telemetry_persone_azzera(void) { notify(N_AZZERA); }
void telemetry_send_now(void) { notify(N_SEND_NOW); }

// ------------------------------------------------------------------ Wi-Fi

static void wifi_event(void *arg, esp_event_base_t base, int32_t id, void *data) {
    if (base == WIFI_EVENT && id == WIFI_EVENT_STA_DISCONNECTED) {
        got_ip = false;
        if (owner) {
            wifi_event_sta_disconnected_t *e = data;
            ESP_LOGW(TAG, "Wi-Fi disconnesso (motivo %d)", e ? e->reason : -1);
            set_error("Wi-Fi: disconnesso (%d)", e ? e->reason : -1);
        }
        notify(N_WAKE);
    } else if (base == WIFI_EVENT && id == WIFI_EVENT_STA_STOP) {
        got_ip = false;
        owner = false;  // qualcuno (wifi.c) ha fermato il Wi-Fi: la connessione non è più nostra
        notify(N_WAKE);
    } else if (base == IP_EVENT && id == IP_EVENT_STA_GOT_IP) {
        ip_event_got_ip_t *e = data;
        got_ip = true;
        snap_lock();
        snprintf(snap.ip, sizeof(snap.ip), IPSTR, IP2STR(&e->ip_info.ip));
        snap_unlock();
        notify(N_WAKE);
    } else if (base == IP_EVENT && id == IP_EVENT_STA_LOST_IP) {
        got_ip = false;
        notify(N_WAKE);
    }
}

static void wifi_start_sta(void) {
    wifi_config_t wc = {0};
    strlcpy((char *)wc.sta.ssid, TELEMETRY_WIFI_SSID, sizeof(wc.sta.ssid));
    if (!TELEMETRY_WIFI_ENTERPRISE) strlcpy((char *)wc.sta.password, TELEMETRY_WIFI_PASSWORD, sizeof(wc.sta.password));
    wc.sta.pmf_cfg.capable = true;
    wc.sta.pmf_cfg.required = false;

    owner = true;  // prima di esp_wifi_connect: gli handler di wifi.c e ui.c lasciano stare
    esp_err_t err = esp_wifi_set_mode(WIFI_MODE_STA);
    if (err == ESP_OK) err = esp_wifi_set_config(WIFI_IF_STA, &wc);
#if TELEMETRY_WIFI_ENTERPRISE
    {
        const char *id = strlen(TELEMETRY_WIFI_EAP_IDENTITY) ? TELEMETRY_WIFI_EAP_IDENTITY : TELEMETRY_WIFI_EAP_USERNAME;
        esp_wifi_sta_wpa2_ent_set_identity((const unsigned char *)id, strlen(id));
        esp_wifi_sta_wpa2_ent_set_username((const unsigned char *)TELEMETRY_WIFI_EAP_USERNAME,
                                           strlen(TELEMETRY_WIFI_EAP_USERNAME));
        esp_wifi_sta_wpa2_ent_set_password((const unsigned char *)TELEMETRY_WIFI_PASSWORD,
                                           strlen(TELEMETRY_WIFI_PASSWORD));
        esp_wifi_sta_wpa2_ent_enable();
    }
#else
    // la sincronizzazione del programma (wifi.c) può aver lasciato attivo l'802.1X di EMF Camp
    esp_wifi_sta_wpa2_ent_disable();
#endif
    if (err == ESP_OK) err = esp_wifi_start();
    if (err == ESP_OK) err = esp_wifi_connect();
    if (err != ESP_OK) {
        ESP_LOGE(TAG, "avvio STA fallito: %s", esp_err_to_name(err));
        set_error("Wi-Fi: %s", esp_err_to_name(err));
    } else {
        ESP_LOGI(TAG, "connessione a \"%s\"...", TELEMETRY_WIFI_SSID);
    }
}

// ------------------------------------------------------------------ MQTT

// Comandi su napoli/nodi/<id>/cmd (nel task di ESP-MQTT: qui solo flag, notifiche e testo).
static void handle_cmd(const char *data, int len) {
    if (len <= 0 || len > 512) return;
    cJSON *j = cJSON_ParseWithLength(data, len);
    if (!j) {
        // testo semplice: lo mostriamo così com'è
        snap_lock();
        int n = len < (int)sizeof(snap.message) - 1 ? len : (int)sizeof(snap.message) - 1;
        memcpy(snap.message, data, n);
        snap.message[n] = '\0';
        snap_unlock();
        return;
    }
    const cJSON *text = cJSON_GetObjectItemCaseSensitive(j, "text");
    if (cJSON_IsString(text) && text->valuestring) {
        set_message(text->valuestring);
        ESP_LOGI(TAG, "messaggio: %s", text->valuestring);
    }
    const cJSON *iv = cJSON_GetObjectItemCaseSensitive(j, "interval");
    if (cJSON_IsNumber(iv) && iv->valuedouble >= 2 && iv->valuedouble <= 3600) {
        interval_s = (int)iv->valuedouble;
        ESP_LOGI(TAG, "nuovo intervallo: %d s", interval_s);
    }
    const cJSON *z = cJSON_GetObjectItemCaseSensitive(j, "zona");
    if (cJSON_IsString(z) && z->valuestring) {
        if (payload_zona_valida(z->valuestring)) {
            snap_lock();
            strlcpy(zona_nuova, z->valuestring, sizeof(zona_nuova));
            snap_unlock();
            notify(N_ZONA);
        } else {
            set_message("zona non valida (es. rotonda_diaz)");
        }
    }
    if (cJSON_IsTrue(cJSON_GetObjectItemCaseSensitive(j, "azzera"))) notify(N_AZZERA);
    if (cJSON_IsTrue(cJSON_GetObjectItemCaseSensitive(j, "read"))) notify(N_SEND_NOW);
    cJSON_Delete(j);
}

static void mqtt_event(void *arg, esp_event_base_t base, int32_t id, void *data) {
    esp_mqtt_event_handle_t e = data;
    switch ((esp_mqtt_event_id_t)id) {
        case MQTT_EVENT_CONNECTED:
            ESP_LOGI(TAG, "MQTT connesso a %s", uri);
            mqtt_connected = true;
            esp_mqtt_client_subscribe(mqtt, topic_cmd, 0);
            set_error("%s", "");
            notify(N_MQTT_CONNECTED);
            break;
        case MQTT_EVENT_DISCONNECTED:
            if (mqtt_connected) ESP_LOGW(TAG, "MQTT disconnesso");
            mqtt_connected = false;
            notify(N_WAKE);
            break;
        case MQTT_EVENT_ERROR:
            if (e->error_handle->error_type == MQTT_ERROR_TYPE_CONNECTION_REFUSED) {
                // 4 = utente/password sbagliati, 5 = non autorizzato
                set_error("MQTT: rifiutato (%d)", e->error_handle->connect_return_code);
                ESP_LOGE(TAG, "broker: connessione rifiutata, codice %d", e->error_handle->connect_return_code);
            } else if (e->error_handle->error_type == MQTT_ERROR_TYPE_TCP_TRANSPORT) {
                set_error("MQTT: rete/TLS 0x%x", e->error_handle->esp_tls_last_esp_err);
                ESP_LOGE(TAG, "broker non raggiungibile: tls 0x%x, stack 0x%x, errno %d",
                         e->error_handle->esp_tls_last_esp_err, e->error_handle->esp_tls_stack_err,
                         e->error_handle->esp_transport_sock_errno);
            }
            break;
        case MQTT_EVENT_DATA:
            // messaggi corti in un solo pezzo (buffer da 1024 byte)
            if (e->current_data_offset == 0 && e->data_len == e->total_data_len && e->topic_len == (int)strlen(topic_cmd) &&
                strncmp(e->topic, topic_cmd, e->topic_len) == 0)
                handle_cmd(e->data, e->data_len);
            break;
        default:
            break;
    }
}

static bool transport_is_tls(void) {
    return strcmp(TELEMETRY_MQTT_TRANSPORT, "mqtts") == 0 || strcmp(TELEMETRY_MQTT_TRANSPORT, "wss") == 0;
}

static void mqtt_setup(void) {
    bool ws = strcmp(TELEMETRY_MQTT_TRANSPORT, "ws") == 0 || strcmp(TELEMETRY_MQTT_TRANSPORT, "wss") == 0;
    snprintf(uri, sizeof(uri), "%s://%s:%d%s", TELEMETRY_MQTT_TRANSPORT, TELEMETRY_MQTT_HOST, TELEMETRY_MQTT_PORT,
             ws ? TELEMETRY_MQTT_WS_PATH : "");

    esp_mqtt_client_config_t cfg = {
        .uri = uri,
        .client_id = device_id,
        // utente vuoto ma password presente: l'utente è l'id (come vuole l'ACL del broker)
        .username = strlen(TELEMETRY_MQTT_USER) ? TELEMETRY_MQTT_USER : (strlen(TELEMETRY_MQTT_PASSWORD) ? device_id : NULL),
        .password = strlen(TELEMETRY_MQTT_PASSWORD) ? TELEMETRY_MQTT_PASSWORD : NULL,
        // last will: se il badge sparisce, il broker pubblica {"online":false} trattenuto al posto suo
        .lwt_topic = topic_stato,
        .lwt_msg = PAYLOAD_STATO_OFFLINE,
        .lwt_msg_len = (int)strlen(PAYLOAD_STATO_OFFLINE),
        .lwt_qos = 1,
        .lwt_retain = 1,
        .keepalive = TELEMETRY_MQTT_KEEPALIVE_S,
        .reconnect_timeout_ms = 5000,
        .network_timeout_ms = 10000,
        .buffer_size = 1024,
        .out_buffer_size = 1024,
        .task_stack = 6144,
    };
    if (transport_is_tls()) {
        if (strlen(TELEMETRY_MQTT_CA_PEM) > 0) {
            cfg.cert_pem = TELEMETRY_MQTT_CA_PEM;
        } else if (!TELEMETRY_MQTT_TLS_INSECURE) {
            cfg.crt_bundle_attach = esp_crt_bundle_attach;
        }
        // senza CA, sdkconfig del badge ha CONFIG_ESP_TLS_SKIP_SERVER_CERT_VERIFY=y: nessuna verifica
    }
    mqtt = esp_mqtt_client_init(&cfg);
    if (!mqtt) {
        ESP_LOGE(TAG, "esp_mqtt_client_init fallita (memoria?)");
        set_error("MQTT: init fallita");
        return;
    }
    esp_mqtt_client_register_event(mqtt, ESP_EVENT_ANY_ID, mqtt_event, NULL);
}

static bool publish(const char *topic, const char *payload, int qos, int retain) {
    if (!mqtt || !mqtt_connected) return false;
    int id = esp_mqtt_client_publish(mqtt, topic, payload, (int)strlen(payload), qos, retain);
    ESP_LOGI(TAG, "%s %s %s", id >= 0 ? "->" : "NON inviato", topic, payload);
    return id >= 0;
}

// ------------------------------------------------------------------ letture

static int ble_count(void) { return telemetry_ble_disabled() ? -1 : (int)count_ble_nodes(); }

// napoli/sensori/<id>/<grandezza> {"zona","valore"}; i sensori assenti (NAN) non vengono inviati.
static bool publish_grandezza(const char *grandezza, double valore, int decimali, int moltiplicatore) {
    char topic[TOPIC_BUF], json[JSON_BUF];
    if (payload_topic_sensore(topic, sizeof(topic), device_id, grandezza) < 0) return false;
    if (payload_lettura_json(json, sizeof(json), zona, valore, decimali, moltiplicatore) < 0) return true;  // assente
    return publish(topic, json, TELEMETRY_MQTT_QOS, 0);
}

// Contapersone: pressioni negli ultimi TELEMETRY_PERSONE_FINESTRA_S secondi.
static bool publish_persone(void) {
    int n = contapersone_conta(&persone, esp_timer_get_time());
    snap_lock();
    snap.persone = n;
    snap_unlock();
    return publish_grandezza("persone", n, 0, TELEMETRY_PERSONE_MOLTIPLICATORE);
}

// napoli/nodi/<id>/stato, trattenuto (QoS 1), rinfrescato a ogni ciclo: rssi, tensione, heap.
static bool publish_stato(const sensors_data_t *d, int nearby, int rssi) {
    char ip[16], sensori[96], json[JSON_BUF];
    snap_lock();
    strlcpy(ip, snap.ip, sizeof(ip));
    strlcpy(sensori, snap.sensors, sizeof(sensori));
    snap_unlock();
    payload_stato_t s;
    payload_stato_init(&s);
    s.online = true;
    s.ruolo = "badge";
    s.zona = zona;
    s.versione = TELEMETRY_FW_VERSION;
    s.ip = ip;
    s.rssi = rssi;
    s.intervallo_s = interval_s;
    s.sensori = sensori;
    s.tensione = d ? d->supply_v : NAN;
    s.badge_vicini = nearby;
    s.heap = (long)esp_get_free_heap_size();
    if (payload_stato_json(&s, json, sizeof(json)) < 0) {
        ESP_LOGE(TAG, "stato oltre %d byte: non inviato", JSON_BUF);
        return false;
    }
    return publish(topic_stato, json, 1, 1);
}

// Un ciclo completo: sensori → una lettura per grandezza, contapersone, stato.
static void read_and_publish(const char *trigger) {
    sensors_data_t d;
    sensors_read(&d);
    int nearby = ble_count();
    wifi_ap_record_t ap;
    int rssi = (got_ip && esp_wifi_sta_get_ap_info(&ap) == ESP_OK) ? ap.rssi : 0;

    bool ok = false;
    if (mqtt_connected) {
        ESP_LOGI(TAG, "pubblicazione (%s), zona %s", trigger, zona);
        ok = publish_stato(&d, nearby, rssi);
        ok = publish_grandezza("temperatura", d.temperature_c, 1, 0) && ok;
        ok = publish_grandezza("umidita", d.humidity_pct, 0, 0) && ok;
        ok = publish_grandezza("luce", d.light_lux, 0, 0) && ok;
        ok = publish_grandezza("pressione", d.pressure_hpa, 1, 0) && ok;
        ok = publish_persone() && ok;
    } else {
        int n = contapersone_conta(&persone, esp_timer_get_time());
        snap_lock();
        snap.persone = n;
        snap_unlock();
    }

    snap_lock();
    snap.data = d;
    snap.has_data = true;
    snap.badges_nearby = nearby;
    snap.rssi = rssi;
    snap.interval_s = interval_s;
    if (ok) {
        snap.sent++;
        snap.last_sent_us = esp_timer_get_time();
    } else if (mqtt_connected) {
        snap.failed++;
    }
    snap_unlock();
}

// ------------------------------------------------------------------ task

static void telemetry_task(void *arg) {
    sensors_init();
    vTaskDelay(pdMS_TO_TICKS(200));  // prima misura del BH1750 in modo continuo: 120-180 ms
    snap_lock();
    strlcpy(snap.sensors, sensors_found(), sizeof(snap.sensors));
    snap_unlock();
    mqtt_setup();

    int64_t next_send = 0, null_since = 0, next_retry = 0;
    int backoff_ms = 2000;
    const char *pending_trigger = "boot";

    for (;;) {
        uint32_t bits = 0;
        xTaskNotifyWait(0, UINT32_MAX, &bits, pdMS_TO_TICKS(500));
        int64_t now = esp_timer_get_time();

        // 1) Wi-Fi: chi lo sta usando?
        wifi_mode_t mode = WIFI_MODE_NULL;
        esp_wifi_get_mode(&mode);
        if (mode == WIFI_MODE_AP || mode == WIFI_MODE_APSTA) {
            owner = false;  // l'utente usa l'AP (web del badge): pausa
            null_since = 0;
            set_state(TELEMETRY_PAUSED_AP);
        } else if (mode == WIFI_MODE_NULL) {
            if (!null_since) null_since = now;
            set_state(TELEMETRY_WIFI_WAIT);
            if (now - null_since > 3000000) {  // libero da 3 s: tocca a noi
                null_since = 0;
                wifi_start_sta();
                next_retry = now + 20000000LL;  // prima connessione: 20 s
                backoff_ms = 2000;
            }
        } else {  // STA: nostra o della sincronizzazione del programma
            null_since = 0;
            if (!got_ip) {
                set_state(TELEMETRY_WIFI_WAIT);
                if (owner && now >= next_retry) {
                    ESP_LOGI(TAG, "nuovo tentativo Wi-Fi (attesa %d ms)", backoff_ms);
                    esp_wifi_connect();
                    next_retry = now + (int64_t)backoff_ms * 1000;
                    backoff_ms = backoff_ms * 2 > 30000 ? 30000 : backoff_ms * 2;
                }
            } else {
                backoff_ms = 2000;
            }
        }

        // 2) MQTT: si avvia al primo IP e non si ferma più; la riconnessione (ogni 5 s) la fa ESP-MQTT.
        // Niente esp_mqtt_client_stop(): manderebbe DISCONNECT e il broker NON pubblicherebbe il
        // last will (e se la scrittura fallisce ritorna errore senza fermare il client).
        if (mqtt && got_ip && !mqtt_started) {
            if (esp_mqtt_client_start(mqtt) == ESP_OK) mqtt_started = true;
        }
        if (got_ip) set_state(mqtt_connected ? TELEMETRY_ONLINE : TELEMETRY_MQTT_WAIT);

        // 3) comandi e pulsanti
        if (bits & N_ZONA) {
            snap_lock();
            strlcpy(zona, zona_nuova, sizeof(zona));
            strlcpy(snap.zone, zona, sizeof(snap.zone));
            snap_unlock();
            ESP_LOGI(TAG, "nuova zona: %s", zona);
            bits |= N_SEND_NOW;  // stato e letture subito con la zona nuova
        }
        if (bits & N_PIU) {
            contapersone_aggiungi(&persone, now);
            if (!publish_persone()) {
                snap_lock();
                snap.failed++;
                snap_unlock();
            }
        }
        if (bits & N_AZZERA) {
            contapersone_azzera(&persone);
            publish_persone();
            ESP_LOGI(TAG, "contapersone azzerato");
        }

        // 4) pubblicazioni periodiche
        if (bits & N_MQTT_CONNECTED) {
            read_and_publish(pending_trigger);  // stato e letture subito dopo ogni connessione
            pending_trigger = "riconnessione";
            next_send = now + (int64_t)interval_s * 1000000;
        } else if ((bits & N_SEND_NOW) || now >= next_send) {
            read_and_publish((bits & N_SEND_NOW) ? "comando" : "intervallo");
            next_send = now + (int64_t)interval_s * 1000000;
        } else {
            // il conteggio scende da solo quando le pressioni escono dalla finestra: la UI lo vede subito
            int n = contapersone_conta(&persone, now);
            snap_lock();
            snap.persone = n;
            snap_unlock();
        }
    }
}

void telemetry_start(void) {
    snap_mutex = xSemaphoreCreateMutex();
    memset(&snap, 0, sizeof(snap));
    snap.badges_nearby = -1;
    snap.interval_s = interval_s;
    contapersone_init(&persone, TELEMETRY_PERSONE_FINESTRA_S);
    strlcpy(zona, TELEMETRY_ZONE, sizeof(zona));

    // id: quello configurato; altrimenti l'utente MQTT (l'ACL di cloud/mqtt fa scrivere ogni
    // utente solo sotto napoli/sensori/<utente>/# e napoli/nodi/<utente>/#); altrimenti "badge-<MAC>".
    if (strlen(TELEMETRY_DEVICE_ID) > 0) {
        strlcpy(device_id, TELEMETRY_DEVICE_ID, sizeof(device_id));
    } else if (strlen(TELEMETRY_MQTT_USER) > 0) {
        strlcpy(device_id, TELEMETRY_MQTT_USER, sizeof(device_id));
    } else {
        snprintf(device_id, sizeof(device_id), "badge-%04x", badge_obj.short_mac);
    }
    payload_ripulisci_id(device_id);
    strlcpy(snap.device_id, device_id, sizeof(snap.device_id));
    strlcpy(snap.zone, zona, sizeof(snap.zone));

    if (!telemetry_enabled()) {
        ESP_LOGW(TAG, "telemetria disattivata (TELEMETRY_ENABLED 0 o TELEMETRY_WIFI_SSID vuoto)");
        snap.state = TELEMETRY_OFF;
        return;
    }
    if (!payload_zona_valida(zona)) ESP_LOGW(TAG, "zona \"%s\" non valida: le letture non verranno inviate", zona);
    payload_topic_nodo(topic_stato, sizeof(topic_stato), device_id, "stato");
    payload_topic_nodo(topic_cmd, sizeof(topic_cmd), device_id, "cmd");
    ESP_LOGI(TAG, "%s → %s://%s:%d, zona %s, stato su %s", device_id, TELEMETRY_MQTT_TRANSPORT, TELEMETRY_MQTT_HOST,
             TELEMETRY_MQTT_PORT, zona, topic_stato);

    ESP_ERROR_CHECK(esp_event_handler_register(WIFI_EVENT, WIFI_EVENT_STA_DISCONNECTED, wifi_event, NULL));
    ESP_ERROR_CHECK(esp_event_handler_register(WIFI_EVENT, WIFI_EVENT_STA_STOP, wifi_event, NULL));
    ESP_ERROR_CHECK(esp_event_handler_register(IP_EVENT, IP_EVENT_STA_GOT_IP, wifi_event, NULL));
    ESP_ERROR_CHECK(esp_event_handler_register(IP_EVENT, IP_EVENT_STA_LOST_IP, wifi_event, NULL));

    snap.state = TELEMETRY_WIFI_WAIT;
    xTaskCreate(telemetry_task, "telemetry", 6144, NULL, 4, &task_handle);
}
