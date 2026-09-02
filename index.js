const fs = require("node:fs");
const path = require("node:path");

const {
    Client,
    GatewayIntentBits,
    REST,
    Routes,
    SlashCommandBuilder,
    PermissionFlagsBits,
    ActivityType,
    MessageFlags,
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
} = require("discord.js");

const {
    joinVoiceChannel,
    entersState,
    VoiceConnectionStatus,
    getVoiceConnection,
} = require("@discordjs/voice");

// ============================================================
// CONFIG
// ============================================================

const TOKEN = process.env.DISCORD_TOKEN || process.env.TOKEN;

const CLIENT_ID = "1543273003822092469";

const SUPPORT_SERVER = "https://discord.gg/JNrsrm8kn";

const DATA_FILE = path.join(__dirname, "voice_channels.json");

// Your custom Discord emoji.
// Note: Discord may display this as text inside bot presence.
const CUSTOM_EMOJI = "<a:Scubbacat:1542552078382272532>";

// Foreign songs/artists only.
const LISTENING_NAMES = [
    "Chris MJ",
    "DJ Khaled",
    "The Weeknd",
    "Drake",
    "Bruno Mars",
    "Justin Bieber",
    "Travis Scott",
    "Future",
    "Central Cee",
    "Tate McRae",
];

// ============================================================
// CHECK TOKEN
// ============================================================

if (!TOKEN) {
    console.error("ERROR: DISCORD_TOKEN environment variable is missing.");
    process.exit(1);
}

// ============================================================
// CLIENT
// ============================================================

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildVoiceStates,
    ],
});

// ============================================================
// VOICE STORAGE
// ============================================================

function loadVoiceChannels() {
    try {
        if (!fs.existsSync(DATA_FILE)) {
            return {};
        }

        const data = fs.readFileSync(DATA_FILE, "utf8");

        if (!data.trim()) {
            return {};
        }

        return JSON.parse(data);
    } catch (error) {
        console.error("Failed to load voice_channels.json:", error);
        return {};
    }
}

function saveVoiceChannels(data) {
    try {
        fs.writeFileSync(
            DATA_FILE,
            JSON.stringify(data, null, 2),
            "utf8"
        );
    } catch (error) {
        console.error("Failed to save voice_channels.json:", error);
    }
}

let savedVoiceChannels = loadVoiceChannels();

// ============================================================
// ADMIN CHECK
// ============================================================

function isAdmin(interaction) {
    if (!interaction.guild) {
        return false;
    }

    return interaction.memberPermissions?.has(
        PermissionFlagsBits.Administrator
    );
}

// ============================================================
// JOIN SAVED VOICE CHANNEL
// ============================================================

async function joinSavedVoiceChannel(guild) {
    const channelId = savedVoiceChannels[guild.id];

    if (!channelId) {
        return null;
    }

    const channel = guild.channels.cache.get(channelId);

    if (!channel) {
        delete savedVoiceChannels[guild.id];
        saveVoiceChannels(savedVoiceChannels);

        console.log(
            `[VOICE] Saved channel no longer exists in ${guild.name}.`
        );

        return null;
    }

    if (!channel.isVoiceBased()) {
        delete savedVoiceChannels[guild.id];
        saveVoiceChannels(savedVoiceChannels);

        console.log(
            `[VOICE] Saved channel is not a voice channel in ${guild.name}.`
        );

        return null;
    }

    try {
        const oldConnection = getVoiceConnection(guild.id);

        if (oldConnection) {
            oldConnection.destroy();
        }

        const connection = joinVoiceChannel({
            channelId: channel.id,
            guildId: guild.id,
            adapterCreator: guild.voiceAdapterCreator,
            selfDeaf: true,
            selfMute: false,
        });

        await entersState(
            connection,
            VoiceConnectionStatus.Ready,
            20_000
        );

        console.log(
            `[VOICE] Connected to ${channel.name} in ${guild.name}.`
        );

        return connection;
    } catch (error) {
        console.error(
            `[VOICE] Failed to join ${guild.name}:`,
            error.message
        );

        return null;
    }
}

// ============================================================
// RECONNECT HANDLER
// ============================================================

function setupConnectionRecovery(connection, guild) {
    let reconnecting = false;

    connection.on(
        VoiceConnectionStatus.Disconnected,
        async () => {
            if (reconnecting) {
                return;
            }

            // If /disconnect was used, do not reconnect.
            if (!savedVoiceChannels[guild.id]) {
                return;
            }

            reconnecting = true;

            console.log(
                `[VOICE] Connection lost in ${guild.name}. Reconnecting...`
            );

            try {
                await entersState(
                    connection,
                    VoiceConnectionStatus.Signalling,
                    5_000
                );

                reconnecting = false;
                console.log(
                    `[VOICE] Connection recovered in ${guild.name}.`
                );
            } catch {
                try {
                    connection.destroy();
                } catch {}

                await new Promise((resolve) =>
                    setTimeout(resolve, 5_000)
                );

                if (savedVoiceChannels[guild.id]) {
                    await joinSavedVoiceChannel(guild);
                }

                reconnecting = false;
            }
        }
    );
}

// ============================================================
// PRESENCE
// ============================================================

let listeningIndex = 0;

function updatePresence() {
    if (!client.user) {
        return;
    }

    const songName =
        LISTENING_NAMES[listeningIndex % LISTENING_NAMES.length];

    listeningIndex++;

    client.user.setPresence({
        status: "dnd",

        activities: [
            {
                name: songName,
                type: ActivityType.Listening,

                // This is text. Discord may not render a server
                // custom emoji inside bot presence.
                state: `${CUSTOM_EMOJI} Music 24/7`,
            },
        ],
    });

    console.log(`[PRESENCE] Listening to ${songName}`);
}

// ============================================================
// SLASH COMMANDS
// ============================================================

const commands = [

    new SlashCommandBuilder()
        .setName("connect")
        .setDescription("Connect the bot to your current voice channel."),

    new SlashCommandBuilder()
        .setName("disconnect")
        .setDescription("Disconnect the bot from the voice channel."),

    new SlashCommandBuilder()
        .setName("help")
        .setDescription("Show bot commands and information."),

    new SlashCommandBuilder()
        .setName("invite")
        .setDescription("Get the bot invite link."),
];

// ============================================================
// REGISTER COMMANDS
// ============================================================

async function registerCommands() {
    const rest = new REST({
        version: "10",
    }).setToken(TOKEN);

    try {
        console.log("[COMMANDS] Registering slash commands...");

        await rest.put(
            Routes.applicationCommands(CLIENT_ID),
            {
                body: commands.map((command) =>
                    command.toJSON()
                ),
            }
        );

        console.log("[COMMANDS] Slash commands registered.");
    } catch (error) {
        console.error(
            "[COMMANDS] Failed to register commands:",
            error
        );
    }
}

// ============================================================
// READY
// ============================================================

client.once("ready", async () => {
    console.log("======================================");
    console.log(`Logged in as ${client.user.tag}`);
    console.log(`Servers: ${client.guilds.cache.size}`);
    console.log("Status: DND");
    console.log("======================================");

    // Set initial presence.
    updatePresence();

    // Rotate Listening status every 5 minutes.
    setInterval(
        updatePresence,
        5 * 60 * 1000
    );

    // Automatically reconnect to saved voice channels.
    for (const guild of client.guilds.cache.values()) {
        if (!savedVoiceChannels[guild.id]) {
            continue;
        }

        console.log(
            `[VOICE] Restoring connection for ${guild.name}...`
        );

        const connection =
            await joinSavedVoiceChannel(guild);

        if (connection) {
            setupConnectionRecovery(
                connection,
                guild
            );
        }
    }
});

// ============================================================
// INTERACTIONS
// ============================================================

client.on("interactionCreate", async (interaction) => {

    if (!interaction.isChatInputCommand()) {
        return;
    }

    // ========================================================
    // /HELP
    // ========================================================

    if (interaction.commandName === "help") {

        const embed = new EmbedBuilder()
            .setTitle("🎵 Music Bot Help")
            .setDescription(
                [
                    "Here are the available commands:",
                    "",
                    "**🎧 Voice**",
                    "`/connect` — Join your current voice channel.",
                    "`/disconnect` — Leave the voice channel.",
                    "",
                    "**🤖 General**",
                    "`/help` — Show this help menu.",
                    "`/invite` — Get the bot invite link.",
                    "",
                    "**🔐 Admin**",
                    "Voice management commands require Administrator permission.",
                    "",
                    `${CUSTOM_EMOJI} Music 24/7`,
                ].join("\n")
            )
            .setFooter({
                text: "Music Bot",
            });

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setLabel("Server Support")
                .setURL(SUPPORT_SERVER)
                .setStyle(ButtonStyle.Link)
        );

        // Private in servers.
        if (interaction.guild) {
            await interaction.reply({
                embeds: [embed],
                components: [row],
                flags: MessageFlags.Ephemeral,
            });
        } else {
            // Normal private DM.
            await interaction.reply({
                embeds: [embed],
                components: [row],
            });
        }

        return;
    }

    // ========================================================
    // /INVITE
    // ========================================================

    if (interaction.commandName === "invite") {

        const inviteURL =
            `https://discord.com/oauth2/authorize` +
            `?client_id=${CLIENT_ID}` +
            `&permissions=8` +
            `&scope=bot%20applications.commands`;

        const embed = new EmbedBuilder()
            .setTitle("🤖 Invite Me")
            .setDescription(
                [
                    "Click the button below to invite the bot.",
                    "",
                    "The generated invite requests Administrator permission.",
                ].join("\n")
            );

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setLabel("Invite Bot")
                .setURL(inviteURL)
                .setStyle(ButtonStyle.Link)
        );

        if (interaction.guild) {
            await interaction.reply({
                embeds: [embed],
                components: [row],
                flags: MessageFlags.Ephemeral,
            });
        } else {
            await interaction.reply({
                embeds: [embed],
                components: [row],
            });
        }

        return;
    }

    // ========================================================
    // COMMANDS BELOW REQUIRE SERVER
    // ========================================================

    if (!interaction.guild) {
        await interaction.reply({
            content:
                "❌ This command can only be used inside a server.",
            flags: MessageFlags.Ephemeral,
        });

        return;
    }

    // ========================================================
    // ADMIN CHECK
    // ========================================================

    if (!isAdmin(interaction)) {
        await interaction.reply({
            content:
                "❌ You need **Administrator** permission to use this command.",
            flags: MessageFlags.Ephemeral,
        });

        return;
    }

    // ========================================================
    // /CONNECT
    // ========================================================

    if (interaction.commandName === "connect") {

        const member = interaction.member;

        const voiceChannel =
            member.voice?.channel;

        if (!voiceChannel) {
            await interaction.reply({
                content:
                    "❌ You must be inside a voice channel first.",
                flags: MessageFlags.Ephemeral,
            });

            return;
        }

        if (!voiceChannel.isVoiceBased()) {
            await interaction.reply({
                content:
                    "❌ That is not a valid voice channel.",
                flags: MessageFlags.Ephemeral,
            });

            return;
        }

        // Save this server's voice channel.
        savedVoiceChannels[interaction.guild.id] =
            voiceChannel.id;

        saveVoiceChannels(savedVoiceChannels);

        try {
            const oldConnection =
                getVoiceConnection(interaction.guild.id);

            if (oldConnection) {
                oldConnection.destroy();
            }

            const connection = joinVoiceChannel({
                channelId: voiceChannel.id,
                guildId: interaction.guild.id,
                adapterCreator:
                    interaction.guild.voiceAdapterCreator,
                selfDeaf: true,
                selfMute: false,
            });

            await entersState(
                connection,
                VoiceConnectionStatus.Ready,
                20_000
            );

            setupConnectionRecovery(
                connection,
                interaction.guild
            );

            await interaction.reply({
                content:
                    `✅ Connected to **${voiceChannel.name}**.\n` +
                    `💾 I will remember this voice channel after a restart.`,
                flags: MessageFlags.Ephemeral,
            });

        } catch (error) {

            console.error(
                "[CONNECT ERROR]",
                error
            );

            await interaction.reply({
                content:
                    "❌ I could not connect to that voice channel. Check my voice permissions.",
                flags: MessageFlags.Ephemeral,
            });
        }

        return;
    }

    // ========================================================
    // /DISCONNECT
    // ========================================================

    if (interaction.commandName === "disconnect") {

        // Remove saved channel first.
        delete savedVoiceChannels[
            interaction.guild.id
        ];

        saveVoiceChannels(savedVoiceChannels);

        const connection =
            getVoiceConnection(
                interaction.guild.id
            );

        if (connection) {
            connection.destroy();
        }

        await interaction.reply({
            content:
                "✅ Disconnected and removed the saved voice channel.",
            flags: MessageFlags.Ephemeral,
        });

        return;
    }
});

// ============================================================
// GUILD DELETE
// ============================================================

client.on("guildDelete", (guild) => {

    if (savedVoiceChannels[guild.id]) {
        delete savedVoiceChannels[guild.id];
        saveVoiceChannels(savedVoiceChannels);
    }

    console.log(
        `[GUILD] Removed saved data for ${guild.name}.`
    );
});

// ============================================================
// ERROR HANDLERS
// ============================================================

client.on("error", (error) => {
    console.error("[CLIENT ERROR]", error);
});

process.on("unhandledRejection", (error) => {
    console.error(
        "[UNHANDLED REJECTION]",
        error
    );
});

process.on("uncaughtException", (error) => {
    console.error(
        "[UNCAUGHT EXCEPTION]",
        error
    );
});

// ============================================================
// START
// ============================================================

(async () => {
    await registerCommands();

    console.log("[BOT] Starting...");

    await client.login(TOKEN);
})();
