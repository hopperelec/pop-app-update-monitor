import {existsSync, readFileSync} from "node:fs";
import googlePlayStore from "google-play-scraper";
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
const DISCORD_FIELD_VALUE_MAX_LENGTH = 1024;
const DISCORD_EMBED_DESCRIPTION_MAX_LENGTH = 4096;
const POP_APP_IDS = {
    android: 'uk.co.nebulalabs.nexusnextgeneration',
    ios: 1169044288,
};
const COUNTRY = 'gb';

interface StoreData {
    popVersion: {
        updated: number;
        version: string;
        devId: string;
    } | null;
    otherApps: string[];
}

const lastVersions: {
    checkedAt: number | null;
    android: StoreData | null;
    ios: StoreData | null;
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

function truncate(value: string, maxLength: number): string {
    if (value.length > maxLength) {
        const truncatedSuffix = `... (truncated)`
        return value.substring(0, maxLength - truncatedSuffix.length) + truncatedSuffix;
    }
    return value;
}

async function handleUpdate(
    platform: string,
    oldVersion: string | null,
    newVersion: string,
    newTimestamp: Date,
    releaseNotes: string,
    url: string
) {
    function log(message: string, ) {
        console.log(` [${platform}] ${message}`);
    }
    async function postUpdate(fields: APIEmbedField[]) {
        if (discordWebhookClient) {
            await discordWebhookClient.send({
                embeds: [{
                    title: `${platform} App Update`,
                    fields,
                    url,
                    timestamp: newTimestamp.toISOString()
                }]
            });
        }
    }

    if (!releaseNotes) releaseNotes = 'No release notes provided.';
    releaseNotes = truncate(releaseNotes, DISCORD_FIELD_VALUE_MAX_LENGTH);

    if (!oldVersion) {
        log(`Initial version recorded: ${newVersion}`);
    } else if (oldVersion === newVersion) {
        log(`New build of ${newVersion} detected`);
        await postUpdate([
            {name: 'Version', value: newVersion, inline: true},
            {name: 'Release Notes', value: releaseNotes}
        ]);
    } else {
        log(`New version detected: ${newVersion} (previous: ${oldVersion})`);
        await postUpdate([
            {name: 'Previous Version', value: oldVersion, inline: true},
            {name: 'New Version', value: newVersion, inline: true},
            {name: 'Release Notes', value: releaseNotes}
        ]);
    }
}

async function handleNewApp(
    platform: string,
    title: string,
    summary: string,
    icon: string,
    url: string,
) {
    summary = truncate(summary, DISCORD_EMBED_DESCRIPTION_MAX_LENGTH);
    console.log(` [${platform}] New app: ${title}`);
    if (discordWebhookClient) {
        await discordWebhookClient.send({
            embeds: [{
                title: `New ${platform} App: ${title}`,
                description: summary,
                url,
                thumbnail: { url: icon },
            }]
        });
    }
}

function getErrorHandler(platform: string) {
    return (err: any) => console.error(` [${platform}] Error:`, err.message);
}

async function checkUpdates() {
    const newCheckedAt = new Date();
    console.log(`[${newCheckedAt.toISOString().substring(0, 19).replace('T', ' ')}] Checking for updates...`);

    const promises = [
        googlePlayStore.app({
            appId: POP_APP_IDS.android,
            country: COUNTRY
        }).then(
            async androidData => {
                const updatedDate = new Date(androidData.updated);
                const updatedTime = updatedDate.getTime();
                if (!lastVersions.android?.popVersion || updatedTime > lastVersions.android.popVersion.updated) {
                    await handleUpdate(
                        'Android',
                        lastVersions.android?.popVersion?.version || null,
                        androidData.version,
                        updatedDate,
                        decodeHtmlEntities(androidData.recentChanges.replaceAll(/<br\s*\/?>/gi, '\n')),
                        `https://play.google.com/store/apps/details?id=${POP_APP_IDS.android}`
                    );
                    if (!lastVersions.android) {
                        lastVersions.android = {
                            popVersion: null,
                            otherApps: []
                        };
                    }
                    lastVersions.android.popVersion = {
                        updated: updatedTime,
                        version: androidData.version,
                        devId: androidData.developerId.replaceAll('+', ' ')
                    };
                }
            }
        ).catch(getErrorHandler('Android')),
        appleAppStore.app({
            id: POP_APP_IDS.ios,
            country: COUNTRY
        }).then(
            async iosData => {
                const updatedDate = new Date(iosData.updated);
                const updatedTime = updatedDate.getTime();
                if (!lastVersions.ios?.popVersion || updatedTime > lastVersions.ios.popVersion.updated) {
                    await handleUpdate(
                        'iOS',
                        lastVersions.ios?.popVersion?.version || null,
                        iosData.version,
                        updatedDate,
                        iosData.releaseNotes,
                        `https://apps.apple.com/app/id${POP_APP_IDS.ios}`
                    );
                    if (!lastVersions.ios) {
                        lastVersions.ios = {
                            popVersion: null,
                            otherApps: []
                        };
                    }
                    lastVersions.ios.popVersion = {
                        updated: updatedTime,
                        version: iosData.version,
                        devId: iosData.developerId
                    };
                }
            },
        ).catch(getErrorHandler('iOS'))
    ];
    if (lastVersions.android?.popVersion) {
        promises.push(
            googlePlayStore.developer({
                devId: lastVersions.android.popVersion.devId,
                country: COUNTRY,
            }).then(devApps => {
                const otherApps = devApps.filter(app => app.appId !== POP_APP_IDS.android);
                for (const app of otherApps) {
                    if (lastVersions.android?.otherApps.includes(app.appId)) continue;
                    handleNewApp(
                        'Android',
                        app.title,
                        app.summary,
                        app.icon,
                        `https://play.google.com/store/apps/details?id=${app.appId}`
                    ).catch(console.error);
                    lastVersions.android?.otherApps.push(app.appId);
                }
            }).catch(getErrorHandler('Android'))
        );
    }
    if (lastVersions.ios?.popVersion) {
        promises.push(
            appleAppStore.developer({
                devId: lastVersions.ios.popVersion.devId,
                country: COUNTRY,
            }).then(devApps => {
                const otherApps = devApps.filter(app => app.id !== POP_APP_IDS.ios);
                for (const app of otherApps) {
                    if (lastVersions.ios?.otherApps.includes(app.id.toString())) continue;
                    handleNewApp(
                        'iOS',
                        app.title,
                        app.description,
                        app.icon,
                        `https://apps.apple.com/app/id${app.id}`
                    ).catch(console.error);
                    lastVersions.ios?.otherApps.push(app.id.toString());
                }
            }).catch(getErrorHandler('iOS'))
        );
    }
    await Promise.all(promises);

    console.log(' Check complete.');
    lastVersions.checkedAt = newCheckedAt.getTime();
    await writeFile(LAST_VERSIONS_FILE, JSON.stringify(lastVersions), 'utf8');
}
checkUpdates().then(() => setInterval(checkUpdates, CHECK_INTERVAL_MS));
