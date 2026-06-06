import {existsSync, readFileSync} from "node:fs";
import googlePlayStore, {IFnAppOptions} from "google-play-scraper";
import appleAppStore from "app-store-scraper";
import {WebhookClient, APIEmbedField} from "discord.js";
import 'dotenv/config';
import {writeFile} from "node:fs/promises";
import {decode as decodeHtmlEntities} from "html-entities";

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

interface Version {
    updated: number;
    version: string;
}

const lastVersions: {
    checkedAt: number | null;
    android: Version | null;
    ios: Version | null;
} = {
    checkedAt: null ,
    android: null,
    ios: null
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

async function handleUpdate(
    name: string,
    oldVersion: string | null,
    newVersion: string,
    releaseNotes: string,
    url: string
) {
    function log(message: string, ) {
        console.log(` [${name}] ${message}`);
    }
    async function postUpdate(fields: APIEmbedField[]) {
        if (discordWebhookClient) {
            await discordWebhookClient.send({
                embeds: [{
                    title: `${name} App Update`,
                    fields,
                    url,
                    timestamp: new Date().toISOString()
                }]
            });
        }
    }

    if (!releaseNotes) releaseNotes = 'No release notes provided.';
    if (!oldVersion) {
        log(`Initial version recorded: ${newVersion}`);
    } else if (oldVersion === newVersion) {
        log(`New build of ${newVersion} detected`);
        await postUpdate([
            {name: 'Version', value: newVersion, inline: true},
            {name: 'Release Notes', value: releaseNotes || 'No release notes provided.'}
        ]);
    } else {
        log(`New version detected: ${newVersion} (previous: ${oldVersion})`);
        await postUpdate([
            {name: 'Previous Version', value: oldVersion, inline: true},
            {name: 'New Version', value: newVersion, inline: true},
            {name: 'Release Notes', value: releaseNotes || 'No release notes provided.'}
        ]);
    }
}

async function checkUpdates() {
    const newCheckedAt = new Date();
    console.log(`[${newCheckedAt.toISOString().substring(0, 19).replace('T', ' ')}] Checking for updates...`);

    await Promise.all([
        googlePlayStore.app(APPS.android).then(
            async androidData => {
                const updated = new Date(androidData.updated).getTime();
                if (!lastVersions.android || updated > lastVersions.android.updated) {
                    await handleUpdate(
                        'Android',
                        lastVersions.android?.version || null,
                        androidData.version,
                        decodeHtmlEntities(androidData.recentChanges.replaceAll(/<br\s*\/?>/gi, '\n')),
                        `https://play.google.com/store/apps/details?id=${APPS.android.appId}`
                    );
                    lastVersions.android = {
                        updated,
                        version: androidData.version
                    };
                }
            }
        ).catch(console.error),
        appleAppStore.app(APPS.ios).then(
            async iosData => {
                const updated = new Date(iosData.updated).getTime();
                if (!lastVersions.ios || updated > lastVersions.ios.updated) {
                    await handleUpdate(
                        'iOS',
                        lastVersions.ios?.version || null,
                        iosData.version,
                        iosData.releaseNotes,
                        `https://apps.apple.com/app/id${APPS.ios.id}`
                    );
                    lastVersions.ios = {
                        updated,
                        version: iosData.version
                    };
                }
            },
        ).catch(console.error)
    ]);

    console.log(' Check complete.');
    lastVersions.checkedAt = newCheckedAt.getTime();
    await writeFile(LAST_VERSIONS_FILE, JSON.stringify(lastVersions), 'utf8');
}
checkUpdates().then(() => setInterval(checkUpdates, CHECK_INTERVAL_MS));
