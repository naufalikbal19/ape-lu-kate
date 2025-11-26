import time
import threading
import requests
from selenium import webdriver
from selenium.webdriver.common.by import By
from selenium.webdriver.chrome.service import Service
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC

# Path ke ChromeDriver
DRIVER_PATH = "C:\\Users\\Admin\\Documents\\nawalabot\\rotator\\chromedriver.exe"

# Konfigurasi Telegram Bot
TELEGRAM_BOT_TOKEN = "8215483226:AAH9kl-Nr4tp2M3sEtvpTsaXk4QVl2_cKYs"  # Ganti dengan token bot Anda
TELEGRAM_CHAT_ID = None  # Akan diisi otomatis dari file atau perintah /installnawalabot

def load_telegram_chat_id():
    global TELEGRAM_CHAT_ID
    try:
        with open("telegram_chat_id.txt", "r") as f:
            TELEGRAM_CHAT_ID = f.read().strip()
            print(f"Chat ID dimuat dari file: {TELEGRAM_CHAT_ID}")
    except FileNotFoundError:
        print("File telegram_chat_id.txt tidak ditemukan. Gunakan /installnawalabot untuk mengatur chat ID.")
    except Exception as e:
        print(f"Error memuat chat ID: {e}")

def save_telegram_chat_id(chat_id):
    global TELEGRAM_CHAT_ID
    try:
        with open("telegram_chat_id.txt", "w") as f:
            f.write(str(chat_id))
        TELEGRAM_CHAT_ID = str(chat_id)
        print(f"Chat ID disimpan: {chat_id}")
    except Exception as e:
        print(f"Error menyimpan chat ID: {e}")
last_safe_message_time = 0  # Waktu terakhir pesan aman dikirim (epoch time)
KUTT_API_KEY = "LB-c9aDly4YE2z3vlhw6M-pfHpoSHMXY1Xq0fcnN"
SAFE_MESSAGE_INTERVAL = 3600  # 1 jam dalam detik

def setup_driver():
    options = Options()
    # Disable headless mode for debugging
    # options.add_argument("--headless")
    options.add_argument("--disable-gpu")
    options.add_argument("--no-sandbox")
    options.add_argument("--disable-dev-shm-usage")
    options.add_argument("--window-size=1920,1080")
    options.add_argument("-ignore-certificate-errors")
    # Add options to reduce logging and errors
    options.add_argument("--disable-extensions")
    options.add_argument("--disable-logging")
    options.add_argument("--log-level=3")
    service = Service(DRIVER_PATH)
    driver = webdriver.Chrome(service=service, options=options)
    return driver

def send_telegram_message(chat_id, message):
    if chat_id is None:
        print("Peringatan: TELEGRAM_CHAT_ID belum diatur. Tidak dapat mengirim pesan.")
        return
    url = f"https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}/sendMessage"
    payload = {"chat_id": chat_id, "text": message}
    try:
        response = requests.post(url, json=payload)
        if response.status_code != 200:
            print(f"Error mengirim pesan: {response.status_code}, {response.text}")
    except Exception as e:
        print(f"Error saat mengirim pesan: {e}")

def get_telegram_updates(last_update_id):
    url = f"https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}/getUpdates"
    params = {"timeout": 30}
    if last_update_id:
        params["offset"] = last_update_id
    try:
        response = requests.get(url, params=params)
        return response.json().get("result", [])
    except Exception as e:
        print(f"Error mengambil updates: {e}")
        return []

def read_list_file(input_file):
    try:
        with open(input_file, 'r') as file:
            return file.read().strip().splitlines()
    except Exception as e:
        print(f"Error membaca file: {e}")
        return []

def process_telegram_command(update):
    try:
        if "message" not in update or "text" not in update["message"]:
            return  # Abaikan jika bukan pesan teks

        message = update["message"]["text"]
        chat_id = update["message"]["chat"]["id"]

        if message == "/installnawalabot":
            save_telegram_chat_id(chat_id)
            send_telegram_message(chat_id, f"✅ Chat ID berhasil disimpan: {chat_id}\nBot Nawala siap digunakan di grup ini.")
        elif message.startswith("/replace"):
            parts = message.split()
            if len(parts) == 3:
                old_domain, new_domain = parts[1], parts[2]
                domains = read_list_file("list.txt")
                if old_domain in domains:
                    domains = [new_domain if d == old_domain else d for d in domains]
                    with open("list.txt", "w") as file:
                        file.write("\n".join(domains))
                    send_telegram_message(chat_id, f"✅ Domain '{old_domain}' telah diganti dengan '{new_domain}' di list.txt.")
                else:
                    send_telegram_message(chat_id, "❌ Domain lama tidak ditemukan di list.txt.")
            else:
                send_telegram_message(chat_id, "❌ Format perintah salah. Gunakan: /replace <domain_lama> <domain_baru>")
        elif message.startswith("/list"):
            domains = read_list_file("list.txt")
            if domains:
                send_telegram_message(chat_id, "📄 Isi list.txt:\n" + "\n".join(domains))
            else:
                send_telegram_message(chat_id, "📂 list.txt kosong atau tidak dapat diakses.")
        else:
            return
    except Exception as e:
        print(f"Error memproses perintah: {e}")

def automate_trustpositif(domains):
    global last_safe_message_time
    driver = setup_driver()
    try:
        driver.get("https://trustpositif.komdigi.go.id/")
        modal_input = WebDriverWait(driver, 10).until(
            EC.element_to_be_clickable((By.ID, "press-to-modal"))
        )
        modal_input.click()
        textarea = WebDriverWait(driver, 10).until(
            EC.visibility_of_element_located((By.ID, "input-data"))
        )
        textarea.click()
        textarea.clear()
        textarea.send_keys('\n'.join(domains))
        search_button = WebDriverWait(driver, 10).until(
            EC.element_to_be_clickable((By.ID, "text-footer1"))
        )
        search_button.click()
        results_table = WebDriverWait(driver, 10).until(
            EC.presence_of_element_located((By.ID, "daftar-block"))
        )
        rows = results_table.find_elements(By.TAG_NAME, "tr")[1:]
        blocked_found = False
        for row in rows:
            columns = row.find_elements(By.TAG_NAME, "td")
            domain, status = columns[0].text, columns[1].text
            if status == "Ada":
                
                send_telegram_message(TELEGRAM_CHAT_ID, f"⚠️ Domain Terblokir: {domain}\nStatus: {status}")
                print(f"Domain Terblokir : {domain} Terkena Nawala")
                blocked_found = True

                # --- LOGIKA BARU UNTUK PENGGANTIAN SHORTLINK ---

                # 1. Baca target-backup.txt untuk mendapatkan domain baru
                new_domain = None
                try:
                    with open("target-backup.txt", "r") as f_backup:
                        for line in f_backup:
                            if line.strip().startswith(f"old domain : {domain}"):
                                parts = line.strip().split(", ")
                                for part in parts:
                                    if part.startswith("new domain : "):
                                        new_domain = part.replace("new domain : ", "").strip()
                                        break
                                if new_domain:
                                    break
                except Exception as e:
                    print(f"Error membaca target-backup.txt: {e}")
                    send_telegram_message(TELEGRAM_CHAT_ID, f"❌ Error membaca target-backup.txt: {e}")
                    continue

                if not new_domain:
                    print(f"Domain baru untuk {domain} tidak ditemukan di target-backup.txt.")
                    send_telegram_message(TELEGRAM_CHAT_ID, f"❌ Domain baru untuk '{domain}' tidak ditemukan di target-backup.txt.")
                    continue

                # 2. Ambil semua link dari Kutt API
                try:
                    get_links_url = "https://kutt.it/api/v2/links"
                    headers = {"X-API-Key": KUTT_API_KEY}
                    all_links_response = requests.get(get_links_url, headers=headers)
                    all_links_response.raise_for_status()
                    all_links = all_links_response.json().get('data', [])

                    # 3. Cari dan update link yang relevan
                    updated_count = 0
                    for link in all_links:
                        if domain in link.get('target', ''):
                            link_id = link['id']
                            old_target = link['target']
                            new_target = old_target.replace(domain, new_domain)

                            patch_url = f"https://kutt.it/api/v2/links/{link_id}"
                            patch_headers = {"X-API-Key": KUTT_API_KEY, "Content-Type": "application/json"}
                            payload = {"target": new_target, "description": "Pergantian Domain Otomatis"}

                            patch_response = requests.patch(patch_url, headers=patch_headers, json=payload)

                            if patch_response.status_code == 200:
                                updated_count += 1
                                print(f"Berhasil update link ID {link_id}: {old_target} -> {new_target}")
                                send_telegram_message(TELEGRAM_CHAT_ID, f"✅ Berhasil update shortlink untuk '{domain}'.\nTarget baru: {new_target}")
                            else:
                                print(f"Gagal update link ID {link_id}: {patch_response.status_code} - {patch_response.text}")
                                send_telegram_message(TELEGRAM_CHAT_ID, f"❌ Gagal update shortlink ID {link_id} untuk domain '{domain}'")

                    if updated_count > 0:
                        # 4. Ganti domain di list.txt dengan domain baru
                        with open("list.txt", "r") as f_list:
                            domains_list = f_list.read().strip().splitlines()
                        
                        domains_list = [new_domain if d == domain else d for d in domains_list]
                        
                        with open("list.txt", "w") as f_list_w:
                            f_list_w.write("\n".join(domains_list))
                        
                        print(f"Domain di list.txt telah diganti dari {domain} menjadi {new_domain}")
                        send_telegram_message(TELEGRAM_CHAT_ID, f"🔄 Domain di list.txt telah diganti dari '{domain}' menjadi '{new_domain}'.")

                except Exception as e:
                    print(f"Error saat proses API Kutt untuk domain {domain}: {e}")
                    send_telegram_message(TELEGRAM_CHAT_ID, f"❌ Error saat proses API Kutt untuk domain {domain}: {e}")
                # --- AKHIR LOGIKA BARU ---
            
            # Kirim pesan aman hanya jika tidak ada domain yang terblokir dan sesuai interval waktu
            if not blocked_found and time.time() - last_safe_message_time > SAFE_MESSAGE_INTERVAL:
                send_telegram_message(TELEGRAM_CHAT_ID, "Update Per Jam : \n👍 Semua Domain Aman")
                print(f"Semua Domain Aman")
                last_safe_message_time = time.time()
    except Exception as e:
        print(f"Error: {e}")
    finally:
        driver.quit()

def run_with_batch(input_file, interval_minutes=2, batch_size=5):
    while True:
        domains = read_list_file(input_file)
        if not domains:
            print("File list.txt kosong. Harap isi dengan domain yang ingin diperiksa.")
            break
        for i in range(0, len(domains), batch_size):
            batch = domains[i:i + batch_size]
            print(f"Memproses batch: {batch}")
            automate_trustpositif(batch)
        print(f"Tunggu {interval_minutes} menit sebelum pengecekan berikutnya...")
        time.sleep(interval_minutes * 60)

def main():
    load_telegram_chat_id()  # Load chat ID from file at startup
    threading.Thread(target=run_with_batch, args=("list.txt",)).start()
    last_update_id = None
    while True:
        updates = get_telegram_updates(last_update_id)
        for update in updates:
            process_telegram_command(update)
            last_update_id = update["update_id"] + 1
        time.sleep(1)

if __name__ == "__main__":
    main()
