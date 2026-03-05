import json
import os
import time
import re
from datetime import datetime, timedelta
from playwright.sync_api import sync_playwright

# Devices we care about mapping
DEVICE_MAP = {
    "Z6-27731": "z6-23134",
    "Z6-27896": "z6-23133"
}

DATA_JSON_PATH = "data.json"
MAX_HISTORY = 600

# Get credentials from environment variables (GitHub Secrets)
EMAIL = "kuk_jong@naver.com"
PASSWORD = "Kimkukjong1!"

def parse_val(text, label):
    m = re.search(label + r"\s+([-\d.]+)", text)
    if m:
        return float(m.group(1))
    return None

def main():
    if not EMAIL or not PASSWORD:
        print("Error: ZENTRA_EMAIL or ZENTRA_PASSWORD environment variables are missing.")
        return

    print(f"Starting scrape at {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")

    # Load existing data.json
    history_data = {}
    if os.path.exists(DATA_JSON_PATH):
        try:
            with open(DATA_JSON_PATH, "r", encoding="utf-8") as f:
                history_data = json.load(f)
        except Exception as e:
            print("Failed to load existing data.json, starting fresh.", e)

    scraped_data_blocks = {}

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True) # Must be headless for GitHub Actions
        context = browser.new_context(viewport={'width': 1280, 'height': 800})
        page = context.new_page()

        print("Navigating to login page...")
        page.goto("https://zentracloud.com/")
        page.fill("input#username", EMAIL)
        page.fill("input#password", PASSWORD)
        page.click("button[type='submit']")
        
        print("Waiting for login to complete...")
        page.wait_for_timeout(10000)
        
        print("Navigating to List view...")
        page.goto("https://zentracloud.com/#/dashboard_list")
        
        # Wait a fixed amount for the dynamic list to render properly
        page.wait_for_timeout(15000)

        # 4. 안전하게 텍스트 요소 통째로 추출 (HTML 태그 클래스에 의존하지 않음)
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
        print("No valid target devices found during scrape. Exiting.")
        return

    now_ts = int(time.time())
    
    # GitHub Actions servers use UTC. Add 9 hours for KST.
    kst_time = datetime.fromtimestamp(now_ts) + timedelta(hours=9)
    dt_str = kst_time.strftime("%Y-%m-%d %H:%M:%S")

    # Process and append data
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
