import json
import os
import time
import re
from datetime import datetime
from playwright.sync_api import sync_playwright

DEVICE_MAP = {
    "Z6-27731": "z6-23134",
    "Z6-27896": "z6-23133"
}

DATA_JSON_PATH = "data.json"
MAX_HISTORY = 600

EMAIL = os.environ.get('ZENTRA_EMAIL')
PASSWORD = os.environ.get('ZENTRA_PASSWORD')

def parse_val(text, label):
    m = re.search(label + r"\s+([-\d.]+)", text)
    if m:
        return float(m.group(1))
    return None

def main():
    if not EMAIL or not PASSWORD:
        print("Error: environment variables are missing.")
        return

    history_data = {}
    if os.path.exists(DATA_JSON_PATH):
        try:
            with open(DATA_JSON_PATH, "r", encoding="utf-8") as f:
                history_data = json.load(f)
        except Exception as e:
            pass

    scraped_data_blocks = {}

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context(viewport={'width': 1280, 'height': 800})
        page = context.new_page()

        page.goto("https://zentracloud.com/")
        page.fill("input#username", EMAIL)
        page.fill("input#password", PASSWORD)
        page.click("button[type='submit']")
        
        page.wait_for_timeout(15000)
        
        try:
            page.evaluate("document.querySelector('button[data-hash=\"dashboard_list\"]').click()")
        except Exception as e:
            page.goto("https://zentracloud.com/#/dashboard_list")

        page.wait_for_timeout(15000)

        inner_text = page.evaluate("document.body.innerText")
        lines = inner_text.split('\n')
        
        temp_blocks = {}
        current_device = None
        for line in lines:
            line = line.strip()
            m = re.search(r'(z6-\d{5})', line, re.IGNORECASE)
            if m:
                current_device = m.group(1).upper()
                if current_device not in temp_blocks:
                    temp_blocks[current_device] = ""
            
            if current_device:
                temp_blocks[current_device] += line + "\n"

        for real_id, text in temp_blocks.items():
            if real_id in DEVICE_MAP:
                mapped_id = DEVICE_MAP[real_id]
                scraped_data_blocks[mapped_id] = text

        page.screenshot(path="debug_github.png")
        browser.close()

    if not scraped_data_blocks:
        return

    now_ts = int(time.time())
    dt_str = datetime.fromtimestamp(now_ts).strftime("%Y-%m-%d %H:%M:%S")

    for dev_id, block in scraped_data_blocks.items():
        if dev_id not in history_data:
            history_data[dev_id] = []

        temp = parse_val(block, "Air Temperature")
        hum = parse_val(block, "RH Sensor Temp")
        rh_match = re.search(r"Humidity\s*[%]?\s*([-\d.]+)", block)
        if rh_match:
            hum = float(rh_match.group(1))
        elif temp:
             hum = 65.0 

        soil_temp = parse_val(block, "Soil Temperature")
        water_content = parse_val(block, "Water Content")
        solar = parse_val(block, "Solar Radiation")
        ec = parse_val(block, "Saturation Extract EC")
        vpd = parse_val(block, "VPD")
        battery = parse_val(block, "Battery Percent")
        
        data_mapped = {
            "temperature": temp if temp is not None else 0,
            "humidity": hum if hum is not None else 0,
            "soil_temp": soil_temp if soil_temp is not None else 0,
            "water_content": water_content if water_content is not None else 0,
            "solar": solar if solar is not None else 0,
            "ec": ec if ec is not None else 0,
            "vpd": vpd if vpd is not None else 0,
            "battery": battery if battery is not None else 0
        }

        if not history_data[dev_id] or history_data[dev_id][-1]["timestamp_utc"] < now_ts - 60:
            history_data[dev_id].append({
                "timestamp_utc": now_ts,
                "datetime": dt_str,
                "data": data_mapped
            })

            if len(history_data[dev_id]) > MAX_HISTORY:
                history_data[dev_id].pop(0)

    with open(DATA_JSON_PATH, "w", encoding="utf-8") as f:
        json.dump(history_data, f, ensure_ascii=False)

if __name__ == "__main__":
    main()
