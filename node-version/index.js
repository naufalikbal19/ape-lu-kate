import puppeteer from 'puppeteer';
import fetch from 'node-fetch';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
let TELEGRAM_CHAT_ID = null; // Will be loaded from file or set by command

const KUTT_API_KEY = process.env.KUTT_API_KEY;
const SAFE_MESSAGE_INTERVAL = 3600; // 1 hour in seconds
let lastSafeMessageTime = 0; // Last time safe message was sent (epoch time)

const TELEGRAM_CHAT_ID_FILE = path.join(__dirname, 'telegram_chat_id.txt');
const LIST_FILE = path.join(__dirname, 'list.txt');
const TARGET_BACKUP_FILE = path.join(__dirname, 'target-backup.txt');

async function loadTelegramChatId() {
    try {
        const chat_id = await fs.readFile(TELEGRAM_CHAT_ID_FILE, 'utf8');
        TELEGRAM_CHAT_ID = chat_id.trim();
        console.log(`Chat ID loaded from file: ${TELEGRAM_CHAT_ID}`);
    } catch (error) {
        if (error.code === 'ENOENT') {
            console.log("File telegram_chat_id.txt not found. Use /installnawalabot to set chat ID.");
        } else {
            console.error(`Error loading chat ID: ${error}`);
        }
    }
}

async function saveTelegramChatId(chat_id) {
    try {
        await fs.writeFile(TELEGRAM_CHAT_ID_FILE, String(chat_id), 'utf8');
        TELEGRAM_CHAT_ID = String(chat_id);
        console.log(`Chat ID saved: ${chat_id}`);
    } catch (error) {
        console.error(`Error saving chat ID: ${error}`);
    }
}

async function setupBrowser() {
    const browser = await puppeteer.launch({
        headless: true, // User requested headless mode
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-gpu',
            '--disable-dev-shm-usage',
            '--window-size=1920,1080',
            '--ignore-certificate-errors',
            '--disable-extensions',
            '--disable-logging',
            '--log-level=3'
        ]
    });
    return browser;
}

async function sendTelegramMessage(chat_id, message) {
    if (!chat_id) {
        console.warn("Warning: TELEGRAM_CHAT_ID is not set. Cannot send message.");
        return;
    }
    const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
    const payload = { chat_id: chat_id, text: message };
    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        if (!response.ok) {
            const errorText = await response.text();
            console.error(`Error sending message: ${response.status}, ${errorText}`);
        }
    } catch (error) {
        console.error(`Error while sending message: ${error}`);
    }
}

async function getTelegramUpdates(last_update_id) {
    const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getUpdates`;
    const params = new URLSearchParams({ timeout: 30 });
    if (last_update_id) {
        params.append('offset', last_update_id);
    }
    try {
        const response = await fetch(`${url}?${params.toString()}`);
        if (!response.ok) {
            const errorText = await response.text();
            console.error(`Error fetching updates: ${response.status}, ${errorText}`);
            return [];
        }
        const data = await response.json();
        return data.result || [];
    } catch (error) {
        console.error(`Error fetching updates: ${error}`);
        return [];
    }
}

async function readListFile(filePath) {
    try {
        const content = await fs.readFile(filePath, 'utf8');
        return content.trim().split('\n').filter(line => line.length > 0);
    } catch (error) {
        if (error.code === 'ENOENT') {
            console.warn(`File not found: ${filePath}. Returning empty list.`);
            return [];
        }
        console.error(`Error reading file ${filePath}: ${error}`);
        return [];
    }
}

async function processTelegramCommand(update) {
    try {
        if (!update.message || !update.message.text) {
            return; // Ignore if not a text message
        }

        const message = update.message.text;
        const chat_id = update.message.chat.id;

        if (message === "/installnawalabot") {
            await saveTelegramChatId(chat_id);
            await sendTelegramMessage(chat_id, `✅ Chat ID successfully saved: ${chat_id}\nNawala Bot is ready to use in this group.`);
        } else if (message.startsWith("/replace")) {
            const parts = message.split(/\s+/); // Split by one or more spaces
            if (parts.length === 3) {
                const oldDomain = parts[1];
                const newDomain = parts[2];
                let domains = await readListFile(LIST_FILE);
                if (domains.includes(oldDomain)) {
                    domains = domains.map(d => (d === oldDomain ? newDomain : d));
                    await fs.writeFile(LIST_FILE, domains.join('\n'), 'utf8');
                    await sendTelegramMessage(chat_id, `✅ Domain '${oldDomain}' has been replaced with '${newDomain}' in list.txt.`);
                } else {
                    await sendTelegramMessage(chat_id, "❌ Old domain not found in list.txt.");
                }
            } else {
                await sendTelegramMessage(chat_id, "❌ Incorrect command format. Use: /replace <old_domain> <new_domain>");
            }
        } else if (message.startsWith("/list")) {
            const domains = await readListFile(LIST_FILE);
            if (domains.length > 0) {
                await sendTelegramMessage(chat_id, "📄 Contents of list.txt:\n" + domains.join('\n'));
            } else {
                await sendTelegramMessage(chat_id, "📂 list.txt is empty or inaccessible.");
            }
        } else {
            return;
        }
    } catch (error) {
        console.error(`Error processing command: ${error}`);
    }
}

async function automateTrustpositif(domains) {
    const browser = await setupBrowser();
    const page = await browser.newPage();
    let blockedFound = false;

    try {
        await page.goto("https://trustpositif.komdigi.go.id/", { waitUntil: 'networkidle2' });

        // Click the modal input
        await page.waitForSelector("#press-to-modal", { visible: true });
        await page.click("#press-to-modal");

        // Fill the textarea
        await page.waitForSelector("#input-data", { visible: true });
        await page.type("#input-data", domains.join('\n'));

        // Click the search button
        await page.waitForSelector("#text-footer1", { visible: true });
        await page.click("#text-footer1");

        // Wait for results table
        await page.waitForSelector("#daftar-block", { visible: true });

        // Extract results
        const rows = await page.$$("#daftar-block tr");
        // Skip header row
        for (let i = 1; i < rows.length; i++) {
            const row = rows[i];
            const columns = await row.$$('td');
            if (columns.length >= 2) {
                const domain = await columns[0].evaluate(el => el.textContent.trim());
                const status = await columns[1].evaluate(el => el.textContent.trim());

                if (status === "Ada") {
                    blockedFound = true;
                    await sendTelegramMessage(TELEGRAM_CHAT_ID, `⚠️ Blocked Domain: ${domain}\nStatus: ${status}`);
                    console.log(`Blocked Domain: ${domain} affected by Nawala`);

                    // --- NEW LOGIC FOR SHORTLINK REPLACEMENT ---

                    // 1. Read target-backup.txt for new domain
                    let newDomain = null;
                    try {
                        const backupContent = await fs.readFile(TARGET_BACKUP_FILE, 'utf8');
                        const backupLines = backupContent.split('\n');
                        for (const line of backupLines) {
                            if (line.trim().startsWith(`old domain : ${domain}`)) {
                                const parts = line.trim().split(', ');
                                for (const part of parts) {
                                    if (part.startsWith("new domain : ")) {
                                        newDomain = part.replace("new domain : ", "").trim();
                                        break;
                                    }
                                }
                                if (newDomain) {
                                    break;
                                }
                            }
                        }
                    } catch (e) {
                        console.error(`Error reading target-backup.txt: ${e}`);
                        await sendTelegramMessage(TELEGRAM_CHAT_ID, `❌ Error reading target-backup.txt: ${e}`);
                        continue; // Skip to next blocked domain
                    }

                    if (!newDomain) {
                        console.log(`New domain for ${domain} not found in target-backup.txt.`);
                        await sendTelegramMessage(TELEGRAM_CHAT_ID, `❌ New domain for '${domain}' not found in target-backup.txt.`);
                        continue; // Skip to next blocked domain
                    }

                    // 2. Get all links from Kutt API
                    try {
                        const getLinksUrl = "https://kutt.it/api/v2/links";
                        const headers = { "X-API-Key": KUTT_API_KEY };
                        const allLinksResponse = await fetch(getLinksUrl, { headers });
                        if (!allLinksResponse.ok) {
                            throw new Error(`Failed to fetch Kutt links: ${allLinksResponse.status} - ${await allLinksResponse.text()}`);
                        }
                        const allLinksData = await allLinksResponse.json();
                        const allLinks = allLinksData.data || [];

                        // 3. Find and update relevant links
                        let updatedCount = 0;
                        for (const link of allLinks) {
                            if (link.target && link.target.includes(domain)) {
                                const linkId = link.id;
                                const oldTarget = link.target;
                                const newTarget = oldTarget.replace(domain, newDomain);

                                const patchUrl = `https://kutt.it/api/v2/links/${linkId}`;
                                const patchHeaders = {
                                    "X-API-Key": KUTT_API_KEY,
                                    "Content-Type": "application/json"
                                };
                                const payload = { target: newTarget, description: "Automatic Domain Replacement" };

                                const patchResponse = await fetch(patchUrl, {
                                    method: 'PATCH',
                                    headers: patchHeaders,
                                    body: JSON.stringify(payload)
                                });

                                if (patchResponse.ok) {
                                    updatedCount++;
                                    console.log(`Successfully updated link ID ${linkId}: ${oldTarget} -> ${newTarget}`);
                                    await sendTelegramMessage(TELEGRAM_CHAT_ID, `✅ Successfully updated shortlink for '${domain}'.\nNew target: ${newTarget}`);
                                } else {
                                    const errorText = await patchResponse.text();
                                    console.error(`Failed to update link ID ${linkId}: ${patchResponse.status} - ${errorText}`);
                                    await sendTelegramMessage(TELEGRAM_CHAT_ID, `❌ Failed to update shortlink ID ${linkId} for domain '${domain}'`);
                                }
                            }
                        }

                        if (updatedCount > 0) {
                            // 4. Replace domain in list.txt with new domain
                            let domainsList = await readListFile(LIST_FILE);
                            domainsList = domainsList.map(d => (d === domain ? newDomain : d));
                            await fs.writeFile(LIST_FILE, domainsList.join('\n'), 'utf8');

                            console.log(`Domain in list.txt replaced from ${domain} to ${newDomain}`);
                            await sendTelegramMessage(TELEGRAM_CHAT_ID, `🔄 Domain in list.txt replaced from '${domain}' to '${newDomain}'.`);
                        }

                    } catch (e) {
                        console.error(`Error during Kutt API process for domain ${domain}: ${e}`);
                        await sendTelegramMessage(TELEGRAM_CHAT_ID, `❌ Error during Kutt API process for domain ${domain}: ${e}`);
                    }
                    // --- END NEW LOGIC ---
                }
            }
        }

        // Send safe message only if no domains were blocked and according to the interval
        if (!blockedFound && (Date.now() / 1000) - lastSafeMessageTime > SAFE_MESSAGE_INTERVAL) {
            await sendTelegramMessage(TELEGRAM_CHAT_ID, "Hourly Update: \n👍 All Domains Safe");
            console.log("All Domains Safe");
            lastSafeMessageTime = Date.now() / 1000; // Update last sent time
        }

    } catch (error) {
        console.error(`Error in automateTrustpositif: ${error}`);
        await sendTelegramMessage(TELEGRAM_CHAT_ID, `❌ An error occurred during domain check: ${error.message}`);
    } finally {
        await browser.close();
    }
}

async function runWithBatch(intervalMinutes = 2, batchSize = 5) {
    while (true) {
        const domains = await readListFile(LIST_FILE);
        if (domains.length === 0) {
            console.log("list.txt is empty. Please fill it with domains to check.");
            // Wait for a longer period if list is empty to avoid busy-looping
            await new Promise(resolve => setTimeout(resolve, intervalMinutes * 60 * 1000));
            continue;
        }

        for (let i = 0; i < domains.length; i += batchSize) {
            const batch = domains.slice(i, i + batchSize);
            console.log(`Processing batch: ${batch}`);
            await automateTrustpositif(batch);
        }
        console.log(`Waiting for ${intervalMinutes} minutes before next check...`);
        await new Promise(resolve => setTimeout(resolve, intervalMinutes * 60 * 1000));
    }
}

async function main() {
    await loadTelegramChatId(); // Load chat ID from file at startup

    // Start the batch processing in a non-blocking way
    runWithBatch().catch(error => console.error("Error in runWithBatch:", error));

    let lastUpdateId = null;
    while (true) {
        const updates = await getTelegramUpdates(lastUpdateId);
        for (const update of updates) {
            await processTelegramCommand(update);
            lastUpdateId = update.update_id + 1;
        }
        await new Promise(resolve => setTimeout(resolve, 1000)); // Poll every second
    }
}

main().catch(error => console.error("Fatal error in main:", error));