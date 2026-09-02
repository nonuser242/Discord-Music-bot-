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
    .setDescription("Bot-ka ugu xir voice channel-kaaga"),

  new SlashCommandBuilder()
    .setName("disconnect")
    .setDescription("Bot-ka ka saar voice channel-ka"),

  new SlashCommandBuilder()
    .setName("invite")
    .setDescription("Soo saar link-ka bot-ka lagu soo darto"),

  new SlashCommandBuilder()
    .setName("help")
    .setDescription("Hel caawimaad ku saabsan isticmaalka bot-ka"),
].map(command => {
  const obj = command.toJSON();
  obj.integration_types = [0, 1];
  obj.contexts = [0, 1, 2];
  return obj;
});

async function registerCommands() {
  const rest = new REST({ version: "10" }).setToken(TOKEN);
  try {
    console.log("Loading global slash commands to profile...");
    await rest.put(Routes.applicationCommands(CLIENT_ID), { body: commands });
    console.log("Commands profile-ka si sax ah ayaa loogu diwaan-geliyay!");
  } catch (error) {
    console.error("Command registration error:", error);
  }
}

// =====================================================
// DYNAMIC 300+ SONGS & LYRICS SYSTEM
// =====================================================

const artists = [
  "Nicky Jam", "Cris MJ", "The Weeknd", "Drake", "Bad Bunny", 
  "Travis Scott", "Kendrick Lamar", "Post Malone", "Justin Bieber", "Dua Lipa",
  "Rauw Alejandro", "Feid", "Ozuna", "J Balvin", "Daddy Yankee", "Karol G"
];

const songTitles = [
  "Hasta el Amanecer", "Starboy", "God's Plan", "Part Time", "Monaco", 
  "FE!N", "HUMBLE.", "Circles", "Peaches", "Blinding Lights", "One Dance",
  "Rockstar", "Un Preview", "Lala", "Classy 101", "Despacito", "Mi Gente"
];

const lyricsDatabase = [
  ["🎵 'Como tu te llamas yo no se...'", "🎵 'Y de donde vienes tampoco se...'", "🎵 'Lo unico que se es que te quiero a ti...'"],
  ["🎵 'Y si algún día te vuelvo a ver...'", "🎵 'No te olvides de mí...'", "🎵 'Baby, tú ere' mi parte time...'"],
  ["🎵 'I said, ooh, I'm blinded by the lights...'", "🎵 'No, I can't sleep until I feel your touch...'", "🎵 'I'm running out of time...'"],
  ["🎵 'Yeah, I'm gonna take my horse...'", "🎵 'To the old town road...'", "🎵 'I'm gonna ride 'til I can't no more...'"],
  ["🎵 'Looking for a time, yeah...'", "🎵 'I know you want this for life...'", "🎵 'Let's keep it going all night...'"]
];

function getRandomSong() {
  const randomArtist = artists[Math.floor(Math.random() * artists.length)];
  const randomTitle = songTitles[Math.floor(Math.random() * songTitles.length)];
  const randomLyrics = lyricsDatabase[Math.floor(Math.random() * lyricsDatabase.length)];
  
  return {
    artist: randomArtist,
    title: randomTitle,
    duration: 180 + Math.floor(Math.random() * 120), // 3 ilaa 5 daqiiqo
    lyricsLines: randomLyrics
  };
}

let currentSong = getRandomSong();
let lineIndex = 0;
let songStartTime = Date.now();
let lyricsInterval = null;

function startSongPlayer() {
  if (lyricsInterval) clearInterval(lyricsInterval);

  currentSong = getRandomSong();
  songStartTime = Date.now();
  lineIndex = 0;

  updateStatusDisplay();

  // Lyrics-ka hoose ku soo baxaya oo is beddelaya 10-kiiba ilbiriqsi
  lyricsInterval = setInterval(() => {
    lineIndex++;
    if (lineIndex < currentSong.lyricsLines.length) {
      updateStatusDisplay();
    } else {
      lineIndex = 0; // Dib uga bilow lyrics-ka haddii heestu wali socoto
      updateStatusDisplay();
    }
  }, 10000);

  // Marka heestu dhammato, dib u bilaabid hees cusub
  setTimeout(() => {
    if (lyricsInterval) clearInterval(lyricsInterval);
    startSongPlayer();
  }, currentSong.duration * 1000);
}

function updateStatusDisplay() {
  const currentLyric = currentSong.lyricsLines[lineIndex] || currentSong.artist;

  client.user.setPresence({
    status: "dnd",
    activities: [
      {
        name: currentSong.title,
        type: ActivityType.Listening,
        details: `${currentSong.title} - ${currentSong.artist}`, // Magaca heesta & fanaanka
        state: currentLyric,                                     // Lyrics-ka hoose ku soo baxaya!
        timestamps: {
          start: songStartTime,
          end: songStartTime + (currentSong.duration * 1000)
        },
        assets: {
          largeImage: "music", // Halkan waxaa la geliyay asset key-gii aad Developer Portal ku soo gelisay ("music")
          largeText: "Grilll Music"
        }
      }
    ]
  });
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
