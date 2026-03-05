import json
import os
import time
import re
from datetime import datetime
from playwright.sync_api import sync_playwright

# Devices we care about mapping
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

    print(f"Starting scrape at {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")

    history_data = {}
    if os.path.exists(DATA_JSON_PATH):
        try:
            with open(DATA_JSON_PATH, "r", encoding="utf-8") as f:
                history_data = json.load(f)
        except Exception as e:
            print("Failed to load existing data.json, starting fresh.", e)

    scraped_data_blocks = {}

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context(viewport={'width': 1280, 'height': 800})
        page = context.new_page()

        print("Navigating to login page...")
        page.goto("https://zentracloud.com/")
        page.fill("input#username", EMAIL)
        page.fill("input#password", PASSWORD)
        page.click("button[type='submit']")
        
        # 1. 넉넉하게 15초 대기 (로그인 완료 기다림)
        print("Logged in, waiting 15s...")
        page.wait_for_timeout(15000)
        
        # 2. 오전에 성공했던 강제 리스트 클릭 방식 적용
        print("Clicking dashboard_list...")
        try:
            page.evaluate("document.querySelector('button[data-hash=\"dashboard_list\"]').click()")
        except Exception as e:
            print("Could not click list button natively:", e)
            page.goto("https://zentracloud.com/#/dashboard_list")

        # 3. 데이터 로딩을 위해 또 15초 대기
        print("Waiting 15s for devices to load...")
        page.wait_for_timeout(15000)

        # 4. 안전하게 요소 추출
        blocks = page.locator(".station-status").all()
        print(f"Found {len(blocks)} station blocks on the page.")

        for b in blocks:
            text = b.inner_text()
            header_match = re.search(r"(Z6-\d+)", text)
            if header_match:
                real_id = header_match.group(1)
                if real_id in DEVICE_MAP:
                    mapped_id = DEVICE_MAP[real_id]
                    scraped_data_blocks[mapped_id] = text

        browser.close()

    if not scraped_data_blocks:
        print("No valid target devices found during scrape. Exiting WITHOUT save.")
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

        # Prevent duplicate entries within the same minute
        if not history_data[dev_id] or history_data[dev_id][-1]["timestamp_utc"] < now_ts - 60:
            history_data[dev_id].append({
                "timestamp_utc": now_ts,
                "datetime": dt_str,
                "data": data_mapped
            })

            # Keep only the last 600 points per device
            if len(history_data[dev_id]) > MAX_HISTORY:
                history_data[dev_id].pop(0)

    # Save to data.json
    with open(DATA_JSON_PATH, "w", encoding="utf-8") as f:
        json.dump(history_data, f, ensure_ascii=False)
    
    print(f"Successfully saved {len(scraped_data_blocks)} device records to {DATA_JSON_PATH}.")

if __name__ == "__main__":
    main()
