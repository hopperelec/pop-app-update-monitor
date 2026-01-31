import {existsSync, readFileSync, writeFileSync} from "node:fs";
import googlePlayStore, {IFnAppOptions} from "google-play-scraper";
import appleAppStore from "app-store-scraper";
import {WebhookClient} from "discord.js";
import 'dotenv/config';

const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL;
if (!DISCORD_WEBHOOK_URL) {
    console.warn('DISCORD_WEBHOOK_URL environment variable is not set. Will only log updates to console.');
}
const discordWebhookClient = DISCORD_WEBHOOK_URL ? new WebhookClient({ url: DISCORD_WEBHOOK_URL }) : null;

const LAST_VERSIONS_FILE = 'last-versions.json';
const CHECK_INTERVAL_MS = 1000 * 60 * 5; // Check every 5 minutes
const APPS: {
    android: IFnAppOptions,
    ios: { id: number; country: string } // app-store-scraper doesn't have type definitions
} = {
    android: { appId: 'uk.co.nebulalabs.nexusnextgeneration', lang: 'en', country: 'gb' },
    ios: { id: 1169044288, country: 'gb' }
};

const lastVersions = {
    checkedAt: null as string,
    android: null as string,
    ios: null as string
};
if (existsSync(LAST_VERSIONS_FILE)) {
    try {
        const fileJson = JSON.parse(readFileSync(LAST_VERSIONS_FILE, 'utf8'));
        lastVersions.checkedAt = fileJson.checkedAt || null;
        lastVersions.android = fileJson.android || null;
        lastVersions.ios = fileJson.ios || null;
    } catch (err) {
        console.error('Error reading last versions file:', err.message);
    }
}

async function checkUpdates() {
    const newCheckedAt = new Date().toISOString();
    console.log(`[${newCheckedAt.substring(0, 19).replace('T', ' ')}] Checking for updates...`);

    await Promise.all([
        googlePlayStore.app(APPS.android)
            .then(
                async androidData => {
                    const currentVer = androidData.version;

                    if (lastVersions.android !== currentVer) {
                        if (lastVersions.android === null) {
                            console.log(' [Android] Initial version recorded:', currentVer);
                        } else {
                            console.log(` [Android] New version detected: ${currentVer} (previous: ${lastVersions.android})`);
                            if (discordWebhookClient) {
                                await discordWebhookClient.send({
                                    embeds: [{
                                        title: 'Android App Update',
                                        fields: [
                                            {name: 'Previous Version', value: lastVersions.android, inline: true},
                                            {name: 'New Version', value: currentVer, inline: true},
                                            {name: 'Release Notes', value: androidData.recentChanges || 'No release notes provided.'}
                                        ],
                                        url: `https://play.google.com/store/apps/details?id=${APPS.android.appId}`,
                                        timestamp: new Date().toISOString()
                                    }]
                                });
                            }
                        }
                        lastVersions.android = currentVer;
                    }
                },
                error => {
                    console.error(` [Android] Error fetching data: ${error.message}`);
                }
            ),
        appleAppStore.app(APPS.ios).then(
            async iosData => {
                const currentVer = iosData.version;

                if (lastVersions.ios !== currentVer) {
                    if (lastVersions.ios === null) {
                        console.log(' [iOS] Initial version recorded:', currentVer);
                    } else {
                        console.log(` [iOS] New version detected: ${currentVer} (previous: ${lastVersions.ios})`);
                        if (discordWebhookClient) {
                            await discordWebhookClient.send({
                                embeds: [{
                                    title: 'iOS App Update',
                                    fields: [
                                        {name: 'Previous Version', value: lastVersions.ios, inline: true},
                                        {name: 'New Version', value: currentVer, inline: true},
                                        {name: 'Release Notes', value: iosData.releaseNotes || 'No release notes provided.'}
                                    ],
                                    url: `https://apps.apple.com/app/id${APPS.ios.id}`,
                                    timestamp: new Date().toISOString()
                                }]
                            });
                        }
                    }
                    lastVersions.ios = currentVer;
                }
            },
            error => {
                console.error(` [iOS] Error fetching data: ${error.message}`);
            }
        )
    ]);

    console.log(' Check complete.');
    lastVersions.checkedAt = newCheckedAt;
    writeFileSync(LAST_VERSIONS_FILE, JSON.stringify(lastVersions), 'utf8');
}
checkUpdates().then(() => setInterval(checkUpdates, CHECK_INTERVAL_MS));
