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
  EmbedBuilder,
  ButtonBuilder,
  ButtonStyle,
  ActionRowBuilder,
  MessageFlags,
} = require("discord.js");

const {
  joinVoiceChannel,
  getVoiceConnection,
  VoiceConnectionStatus,
  entersState,
} = require("@discordjs/voice");

// =====================================================
// CONFIG
// =====================================================

const TOKEN = process.env.TOKEN;
const CLIENT_ID = "1543273003822092469";
const SUPPORT_SERVER = "https://discord.gg/JNrsrm8kn";
const DATA_FILE = path.join(__dirname, "voice_channels.json");

if (!TOKEN) {
  console.error("ERROR: TOKEN is missing.");
  process.exit(1);
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
  ],
});

// =====================================================
// SAVE / LOAD VOICE CHANNELS
// =====================================================

function loadVoiceChannels() {
  try {
    if (!fs.existsSync(DATA_FILE)) return {};
    const data = fs.readFileSync(DATA_FILE, "utf8");
    return JSON.parse(data);
  } catch (error) {
    console.error("Could not load voice channels:", error);
    return {};
  }
}

function saveVoiceChannels(data) {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), "utf8");
  } catch (error) {
    console.error("Could not save voice channels:", error);
  }
}

let savedChannels = loadVoiceChannels();

// =====================================================
// SLASH COMMANDS
// =====================================================

const commands = [
  new SlashCommandBuilder()
    .setName("connect")
    .setDescription("Connect the bot to your voice channel"),

  new SlashCommandBuilder()
    .setName("disconnect")
    .setDescription("Disconnect the bot from the voice channel"),

  new SlashCommandBuilder()
    .setName("invite")
    .setDescription("Get the bot invite link"),

  new SlashCommandBuilder()
    .setName("help")
    .setDescription("Learn how to use the bot"),
].map(command => command.toJSON());

async function registerCommands() {
  const rest = new REST({ version: "10" }).setToken(TOKEN);
  try {
    console.log("| Loading slash commands...");
    await rest.put(Routes.applicationCommands(CLIENT_ID), { body: commands });
    console.log("| Slash Commands Loaded!");
  } catch (error) {
    console.error("Slash command error:", error);
  }
}

// =====================================================
// REAL-TIME LYRICS & SONG DYNAMICS
// =====================================================

const playlist = [
  {
    title: "Cris MJ - Part Time",
    duration: 60,
    lyricsLines: [
      "🎵 Lyrics: 'Y si algún día te vuelvo a ver...'",
      "🎵 Lyrics: 'No te olvides de mí...'",
      "🎵 Lyrics: 'Tú sabes cómo soy...'",
      "🎵 Lyrics: 'Baby, tú ere' mi parte time...'"
    ]
  },
  {
    title: "The Weeknd - Blinding Lights",
    duration: 60,
    lyricsLines: [
      "🎵 Lyrics: 'I've been on my own for long enough...'",
      "🎵 Lyrics: 'I said, ooh, I'm blinded by the lights...'",
      "🎵 Lyrics: 'No, I can't sleep until I feel your touch...'",
      "🎵 Lyrics: 'I'm running out of time...'"
    ]
  },
  {
    title: "Drake - God's Plan",
    duration: 60,
    lyricsLines: [
      "🎵 Lyrics: 'I hold back, sometimes I won't...'",
      "🎵 Lyrics: 'She said, Do you love me? I tell her, Only partly...'",
      "🎵 Lyrics: 'I only love my bed and my mama, I'm sorry...'",
      "🎵 Lyrics: 'God's plan, God's plan...'"
    ]
  }
];

let songIndex = 0;
let lineIndex = 0;
let songStartTime = Date.now();

function startSongPlayer() {
  const currentSong = playlist[songIndex];
  songStartTime = Date.now();
  lineIndex = 0;

  updateLyricsDisplay();

  const lyricsInterval = setInterval(() => {
    lineIndex++;
    if (lineIndex < currentSong.lyricsLines.length) {
      updateLyricsDisplay();
    } else {
      clearInterval(lyricsInterval);
    }
  }, 10000);

  setTimeout(() => {
    clearInterval(lyricsInterval);
    songIndex = (songIndex + 1) % playlist.length;
    startSongPlayer();
  }, currentSong.duration * 1000);
}

function updateLyricsDisplay() {
  const currentSong = playlist[songIndex];

  // Waxaa loo hagaajiyay si uu had iyo goor u ahaado "dnd"
  client.user.setPresence({
    status: "dnd", // Do Not Disturb status
    activities: [
      {
        name: currentSong.title,
        type: ActivityType.Listening,
        state: currentSong.lyricsLines[lineIndex] || currentSong.lyricsLines[0],
        timestamps: {
          start: songStartTime,
          end: songStartTime + (currentSong.duration * 1000)
        }
      },
    ],
  });

  console.log(`[NOW PLAYING] ${currentSong.title} | ${currentSong.lyricsLines[lineIndex]}`);
}

// =====================================================
// VOICE CHANNEL LOGIC
// =====================================================

async function connectToChannel(channel) {
  if (!channel) throw new Error("Voice channel not found.");
  if (!channel.joinable) throw new Error("I do not have permission to join this voice channel.");

  const oldConnection = getVoiceConnection(channel.guild.id);
  if (oldConnection) {
    try { oldConnection.destroy(); } catch (error) { console.error("Old connection error:", error); }
  }

  const connection = joinVoiceChannel({
    channelId: channel.id,
    guildId: channel.guild.id,
    adapterCreator: channel.guild.voiceAdapterCreator,
    selfDeaf: true,
    selfMute: false,
  });

  connection.on(VoiceConnectionStatus.Disconnected, async () => {
    try {
      await Promise.race([
        entersState(connection, VoiceConnectionStatus.Signalling, 5000),
        entersState(connection, VoiceConnectionStatus.Connecting, 5000),
      ]);
    } catch (error) {
      try { connection.rejoin(); } catch (rejoinError) { console.error("Reconnection failed:", rejoinError); }
    }
  });

  try {
    await entersState(connection, VoiceConnectionStatus.Ready, 30000);
    return connection;
  } catch (error) {
    connection.destroy();
    throw error;
  }
}

async function restoreVoiceChannels() {
  console.log(`Restoring ${Object.keys(savedChannels).length} voice channel(s)...`);
  for (const guildId of Object.keys(savedChannels)) {
    const channelId = savedChannels[guildId];
    try {
      const channel = await client.channels.fetch(channelId);
      if (channel && channel.isVoiceBased()) {
        await connectToChannel(channel);
      }
    } catch (error) {
      console.error(`Could not restore voice channel ${channelId}:`, error.message);
    }
  }
}

// =====================================================
// READY EVENT
// =====================================================

client.once("clientReady", async () => {
  console.log(`Bot Online: ${client.user.tag}`);

  await registerCommands();
  startSongPlayer();
  await restoreVoiceChannels();
});

// =====================================================
// INTERACTION HANDLER
// =====================================================

async function replyPrivate(interaction, content) {
  const options = { content, flags: MessageFlags.Ephemeral };
  if (interaction.replied || interaction.deferred) {
    return interaction.followUp(options);
  }
  return interaction.reply(options);
}

client.on("interactionCreate", async interaction => {
  if (!interaction.isChatInputCommand()) return;

  if (interaction.commandName === "connect") {
    if (!interaction.guild) return interaction.reply({ content: "❌ Server-ka kaliya ayaa laga isticmaali karaa." });
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
      return replyPrivate(interaction, "❌ Admins kaliya ayaa amarkan isticmaali kara.");
    }

    const voiceChannel = interaction.member?.voice?.channel;
    if (!voiceChannel) return replyPrivate(interaction, "❌ Horta gal Voice Channel!");

    try {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      await connectToChannel(voiceChannel);

      savedChannels[interaction.guild.id] = voiceChannel.id;
      saveVoiceChannels(savedChannels);

      await interaction.editReply(`✅ Waxaan galay **${voiceChannel.name}**.`);
    } catch (error) {
      await interaction.editReply(`❌ Cillad ayaa ka dhacday ku xirida voice-ka.`);
    }
    return;
  }

  if (interaction.commandName === "disconnect") {
    if (!interaction.guild) return interaction.reply({ content: "❌ Server-ka kaliya ayaa laga isticmaali karaa." });
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
      return replyPrivate(interaction, "❌ Admins kaliya ayaa amarkan isticmaali kara.");
    }

    try {
      const connection = getVoiceConnection(interaction.guild.id);
      if (connection) connection.destroy();

      delete savedChannels[interaction.guild.id];
      saveVoiceChannels(savedChannels);

      return replyPrivate(interaction, "👋 Ka bixidda voice channel waa lagu guuleystay.");
    } catch (error) {
      return replyPrivate(interaction, "❌ Cillad ayaa dhacday.");
    }
  }

  if (interaction.commandName === "invite") {
    const inviteURL = `https://discord.com/oauth2/authorize?client_id=${CLIENT_ID}&permissions=8&integration_type=0&scope=bot+applications.commands`;
    const button = new ButtonBuilder().setLabel("Invite Bot").setStyle(ButtonStyle.Link).setURL(inviteURL);
    const row = new ActionRowBuilder().addComponents(button);
    const embed = new EmbedBuilder().setTitle("🤖 Invite Bot").setDescription("Guji button-ka hoose si aad bot-ka u soo darto.");

    return interaction.reply({ embeds: [embed], components: [row], flags: interaction.guild ? MessageFlags.Ephemeral : undefined });
  }

  if (interaction.commandName === "help") {
    const supportButton = new ButtonBuilder().setLabel("Server Support").setStyle(ButtonStyle.Link).setURL(SUPPORT_SERVER);
    const row = new ActionRowBuilder().addComponents(supportButton);
    const embed = new EmbedBuilder()
      .setTitle("🤖 Bot Commands")
      .addFields(
        { name: "/connect", value: "Bot-ku wuxuu galayaa voice channel-ka." },
        { name: "/disconnect", value: "Bot-ku wuxuu ka baxayaa voice channel-ka." },
        { name: "/invite", value: "Soo saar link-ka bot-ka." },
        { name: "/help", value: "Muuji caawimada." }
      );

    return interaction.reply({ embeds: [embed], components: [row], flags: interaction.guild ? MessageFlags.Ephemeral : undefined });
  }
});

// =====================================================
// LOGIN
// =====================================================

client.login(TOKEN);
