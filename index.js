const {
  Client,
  GatewayIntentBits,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  REST,
  Routes,
  SlashCommandBuilder,
  EmbedBuilder,
  PermissionFlagsBits,
  ActivityType,
  MessageFlags
} = require("discord.js");

const {
  joinVoiceChannel,
  createAudioPlayer,
  createAudioResource,
  AudioPlayerStatus,
  VoiceConnectionStatus,
  entersState,
  getVoiceConnection,
  NoSubscriberBehavior
} = require("@discordjs/voice");

const play = require("@iamtraction/play-dl");

/*
  IMPORTANT:
  Put these in Kinesis Environment Variables.

  TOKEN = your_new_bot_token
  CLIENT_ID = 1543273003822092469
*/

const TOKEN = process.env.TOKEN;
const CLIENT_ID = process.env.CLIENT_ID || "1543273003822092469";

if (!TOKEN) {
  console.error("❌ TOKEN environment variable is missing!");
  process.exit(1);
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates
  ]
});

const players = new Map();


/* =========================
   SLASH COMMANDS
========================= */

const commands = [
  new SlashCommandBuilder()
    .setName("play")
    .setDescription("Play a song in your voice channel.")
    .addStringOption(option =>
      option
        .setName("song")
        .setDescription("Song name or YouTube link")
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("connect")
    .setDescription("Connect the bot to your voice channel."),

  new SlashCommandBuilder()
    .setName("disconnect")
    .setDescription("Disconnect the bot from the voice channel."),

  new SlashCommandBuilder()
    .setName("invite")
    .setDescription("Get the bot invite link."),

  new SlashCommandBuilder()
    .setName("clean")
    .setDescription("Delete messages from this channel.")
    .setDefaultMemberPermissions(
      PermissionFlagsBits.ManageMessages
    ),

  new SlashCommandBuilder()
    .setName("help")
    .setDescription("Show all bot commands.")

].map(command => command.toJSON());


/* =========================
   TIME FUNCTIONS
========================= */

function formatMs(ms) {
  if (!Number.isFinite(ms) || ms < 0) ms = 0;

  const totalSeconds = Math.floor(ms / 1000);

  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor(
    (totalSeconds % 3600) / 60
  );

  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }

  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}


function durationToMs(duration) {
  if (!duration || typeof duration !== "string") {
    return 0;
  }

  const parts = duration.split(":").map(Number);

  if (parts.some(isNaN)) {
    return 0;
  }

  if (parts.length === 2) {
    return (
      parts[0] * 60 * 1000 +
      parts[1] * 1000
    );
  }

  if (parts.length === 3) {
    return (
      parts[0] * 3600 * 1000 +
      parts[1] * 60 * 1000 +
      parts[2] * 1000
    );
  }

  return 0;
}


/* =========================
   PROGRESS BAR
========================= */

function createProgressBar(currentMs, totalDuration) {
  const totalMs = durationToMs(totalDuration);

  if (!totalMs) {
    return "`🔘▬▬▬▬▬▬▬▬▬▬`";
  }

  const percentage = Math.min(
    Math.max(currentMs / totalMs, 0),
    1
  );

  const size = 12;

  const position = Math.round(
    percentage * size
  );

  let bar = "";

  for (let i = 0; i <= size; i++) {
    if (i === position) {
      bar += "🔘";
    } else {
      bar += "▬";
    }
  }

  return (
    `\`${bar}\`\n` +
    `\`${formatMs(currentMs)} / ${totalDuration}\``
  );
}


/* =========================
   LYRICS
========================= */

function cleanSongTitle(title = "") {
  return title
    .replace(/\(Official Music Video\)/gi, "")
    .replace(/\(Official Video\)/gi, "")
    .replace(/\(Official Audio\)/gi, "")
    .replace(/\(Lyrics\)/gi, "")
    .replace(/\[.*?\]/g, "")
    .replace(/\|.*$/g, "")
    .trim();
}


function parseSyncedLyrics(text) {
  if (!text) return [];

  const lines = text.split("\n");

  const lyrics = [];

  for (const line of lines) {
    const match = line.match(
      /\[(\d+):(\d{2})(?:\.(\d{1,3}))?\]/
    );

    if (!match) continue;

    const minutes = Number(match[1]);
    const seconds = Number(match[2]);

    let milliseconds = match[3]
      ? Number(
          match[3].padEnd(3, "0")
        )
      : 0;

    const timeMs =
      minutes * 60 * 1000 +
      seconds * 1000 +
      milliseconds;

    const lyricText = line
      .replace(
        /\[(\d+):(\d{2})(?:\.(\d{1,3}))?\]/,
        ""
      )
      .trim();

    if (lyricText) {
      lyrics.push({
        timeMs,
        text: lyricText
      });
    }
  }

  return lyrics;
}


async function fetchLyrics(songTitle) {
  try {
    const query = cleanSongTitle(songTitle);

    if (!query) return [];

    const response = await fetch(
      `https://lrclib.net/api/search?q=${encodeURIComponent(query)}`,
      {
        headers: {
          "User-Agent":
            "Discord Music Bot"
        }
      }
    );

    if (!response.ok) {
      return [];
    }

    const data = await response.json();

    if (!Array.isArray(data)) {
      return [];
    }

    const synced = data.find(
      song => song.syncedLyrics
    );

    if (!synced?.syncedLyrics) {
      return [];
    }

    return parseSyncedLyrics(
      synced.syncedLyrics
    );

  } catch (error) {
    console.log(
      "Lyrics error:",
      error.message
    );

    return [];
  }
}


/* =========================
   CURRENT LYRICS
========================= */

function getLyricsDisplay(
  musicData,
  ended = false
) {
  if (ended) {
    return "🏁 **The song has finished.**";
  }

  const lyrics =
    musicData.current?.lyrics || [];

  if (!lyrics.length) {
    return "-# Lyrics unavailable";
  }

  const currentMs =
    musicData.resource?.playbackDuration || 0;

  let currentIndex = -1;

  for (let i = 0; i < lyrics.length; i++) {
    if (
      lyrics[i].timeMs <= currentMs
    ) {
      currentIndex = i;
    } else {
      break;
    }
  }

  if (currentIndex === -1) {
    return `-# ${lyrics[0].text}`;
  }

  const current =
    lyrics[currentIndex];

  return `**${current.text}**`;
}


/* =========================
   EMBED
========================= */

function createMusicEmbed(
  musicData,
  ended = false
) {
  const song = musicData.current;

  if (!song) return null;

  const currentMs =
    musicData.resource?.playbackDuration || 0;

  const progress = ended
    ? `\`▬▬▬▬▬▬▬▬▬▬▬▬🔘\`\n\`${song.duration} / ${song.duration}\``
    : createProgressBar(
        currentMs,
        song.duration
      );

  const volume =
    Math.round(
      musicData.volume * 100
    );

  const loopText =
    musicData.loop
      ? "Enabled"
      : "Disabled";

  const lyrics = getLyricsDisplay(
    musicData,
    ended
  );

  const embed = new EmbedBuilder()
    .setTitle(
      ended
        ? "🎧 FINISHED"
        : "🎧 NOW PLAYING"
    )
    .setDescription(
      `🎵 **${song.title}**\n\n` +
      `⏱️ ${progress}\n\n` +
      `🔊 Volume: \`${volume}%\`\n` +
      `🔁 Loop: \`${loopText}\`\n\n` +
      `**Lyrics**\n` +
      `${lyrics}`
    )
    .setColor(
      ended
        ? 0x2f3136
        : 0xff007f
    );

  if (song.thumbnail) {
    embed.setThumbnail(
      song.thumbnail
    );
  }

  return embed;
}


/* =========================
   BUTTONS
========================= */

function createMusicButtons() {
  const row =
    new ActionRowBuilder();

  row.addComponents(

    new ButtonBuilder()
      .setCustomId(
        "pause_resume"
      )
      .setLabel(
        "Pause / Resume"
      )
      .setEmoji("⏯️")
      .setStyle(
        ButtonStyle.Primary
      ),

    new ButtonBuilder()
      .setCustomId(
        "skip"
      )
      .setLabel("Skip")
      .setEmoji("⏩")
      .setStyle(
        ButtonStyle.Secondary
      ),

    new ButtonBuilder()
      .setCustomId(
        "volume"
      )
      .setLabel("Volume")
      .setEmoji("🔊")
      .setStyle(
        ButtonStyle.Success
      ),

    new ButtonBuilder()
      .setCustomId(
        "loop"
      )
      .setLabel("Loop")
      .setEmoji("🔁")
      .setStyle(
        ButtonStyle.Secondary
      )
  );

  return [row];
}


/* =========================
   UPDATE MUSIC MESSAGE
========================= */

async function updateMusicMessage(
  musicData
) {
  if (
    !musicData.message ||
    !musicData.current
  ) {
    return;
  }

  try {
    await musicData.message.edit({
      embeds: [
        createMusicEmbed(
          musicData
        )
      ],
      components:
        createMusicButtons()
    });

  } catch (error) {
    console.log(
      "Message update error:",
      error.message
    );
  }
}


/* =========================
   BOT STATUS
========================= */

function updateBotStatus(song) {
  if (!client.user) return;

  if (!song) {
    client.user.setActivity(
      "/play | Music",
      {
        type:
          ActivityType.Listening
      }
    );

    return;
  }

  client.user.setActivity(
    song.title.slice(0, 100),
    {
      type:
        ActivityType.Listening
    }
  );
}


/* =========================
   CREATE PLAYER
========================= */

function createMusicPlayer(
  guildId,
  connection
) {
  const player =
    createAudioPlayer({
      behaviors: {
        noSubscriber:
          NoSubscriberBehavior.Play
      }
    });

  const musicData = {
    player,
    connection,

    current: null,
    resource: null,

    queue: [],

    volume: 1,

    loop: false,

    message: null,

    updateInterval: null,

    manuallyStopping: false
  };

  players.set(
    guildId,
    musicData
  );

  connection.subscribe(player);

  player.on(
    AudioPlayerStatus.Idle,
    async () => {
      await playNext(guildId);
    }
  );

  player.on(
    "error",
    async error => {
      console.log(
        "Player error:",
        error.message
      );

      await playNext(guildId);
    }
  );

  return musicData;
}


/* =========================
   PLAY SONG
========================= */

async function playSong(
  guildId,
  song
) {
  const musicData =
    players.get(guildId);

  if (!musicData) return;

  try {
    musicData.current = song;

    updateBotStatus(song);

    if (!song.lyrics) {
      song.lyrics =
        await fetchLyrics(
          song.title
        );
    }

    const stream =
      await play.stream(
        song.url
      );

    const resource =
      createAudioResource(
        stream.stream,
        {
          inputType:
            stream.type,

          inlineVolume: true
        }
      );

    if (resource.volume) {
      resource.volume.setVolume(
        musicData.volume
      );
    }

    musicData.resource =
      resource;

    musicData.player.play(
      resource
    );

    if (
      musicData.updateInterval
    ) {
      clearInterval(
        musicData.updateInterval
      );
    }

    musicData.updateInterval =
      setInterval(
        async () => {
          if (
            musicData.player.state
              .status ===
            AudioPlayerStatus.Playing
          ) {
            await updateMusicMessage(
              musicData
            );
          }
        },
        2000
      );

    await updateMusicMessage(
      musicData
    );

  } catch (error) {
    console.error(
      "PLAY ERROR:",
      error.message
    );

    await playNext(guildId);
  }
}


/* =========================
   NEXT SONG
========================= */

async function playNext(
  guildId
) {
  const musicData =
    players.get(guildId);

  if (!musicData) return;

  if (
    musicData.updateInterval
  ) {
    clearInterval(
      musicData.updateInterval
    );

    musicData.updateInterval =
      null;
  }

  if (
    musicData.loop &&
    musicData.current
  ) {
    return playSong(
      guildId,
      musicData.current
    );
  }

  if (
    musicData.queue.length > 0
  ) {
    const nextSong =
      musicData.queue.shift();

    return playSong(
      guildId,
      nextSong
    );
  }

  musicData.current = null;
  musicData.resource = null;

  updateBotStatus(null);

  /*
    Bot stays in the voice channel.
    It only leaves with /disconnect.
  */

  if (
    musicData.message
  ) {
    try {
      await musicData.message.edit({
        embeds: [
          new EmbedBuilder()
            .setTitle(
              "🎧 Music Player"
            )
            .setDescription(
              "🏁 **Queue finished.**\n\nThe bot is still connected to the voice channel."
            )
            .setColor(
              0x2f3136
            )
        ],
        components: []
      });

    } catch {}
  }
}


/* =========================
   READY
========================= */

client.once(
  "ready",
  async () => {
    console.log(
      `✅ Bot Online: ${client.user.tag}`
    );

    updateBotStatus(null);

    const rest =
      new REST({
        version: "10"
      }).setToken(TOKEN);

    try {
      await rest.put(
        Routes.applicationCommands(
          CLIENT_ID
        ),
        {
          body: commands
        }
      );

      console.log(
        "✅ Slash Commands Loaded!"
      );

    } catch (error) {
      console.error(
        "Command error:",
        error
      );
    }
  }
);


/* =========================
   INTERACTIONS
========================= */

client.on(
  "interactionCreate",
  async interaction => {

    try {

      /* =====================
         SLASH COMMANDS
      ===================== */

      if (
        interaction.isChatInputCommand()
      ) {

        if (
          !interaction.guild
        ) {
          return interaction.reply({
            content:
              "❌ Commands can only be used inside a server.",
            flags:
              MessageFlags.Ephemeral
          });
        }

        const command =
          interaction.commandName;


        /* PLAY */

        if (
          command === "play"
        ) {
          const query =
            interaction.options.getString(
              "song"
            );

          const voiceChannel =
            interaction.member.voice
              .channel;

          if (!voiceChannel) {
            return interaction.reply({
              content:
                "❌ You must join a voice channel first.",
              flags:
                MessageFlags.Ephemeral
            });
          }

          await interaction.deferReply();

          let results;

          try {
            results =
              await play.search(
                query,
                {
                  limit: 1,
                  source: {
                    youtube:
                      "video"
                  }
                }
              );

          } catch (error) {
            return interaction.editReply(
              "❌ Unable to search for that song."
            );
          }

          if (
            !results ||
            results.length === 0
          ) {
            return interaction.editReply(
              "❌ No song found."
            );
          }

          const video =
            results[0];

          const song = {
            title:
              video.title ||
              "Unknown Song",

            url:
              video.url,

            thumbnail:
              video.thumbnails?.at(
                -1
              )?.url || null,

            duration:
              video.durationRaw ||
              "Unknown",

            lyrics: null
          };


          let connection =
            getVoiceConnection(
              interaction.guild.id
            );


          if (!connection) {

            connection =
              joinVoiceChannel({
                channelId:
                  voiceChannel.id,

                guildId:
                  interaction.guild.id,

                adapterCreator:
                  interaction.guild
                    .voiceAdapterCreator,

                selfDeaf: true
              });

            try {
              await entersState(
                connection,
                VoiceConnectionStatus.Ready,
                30000
              );

            } catch {
              connection.destroy();

              return interaction.editReply(
                "❌ Unable to join the voice channel."
              );
            }
          }


          let musicData =
            players.get(
              interaction.guild.id
            );


          if (!musicData) {

            musicData =
              createMusicPlayer(
                interaction.guild.id,
                connection
              );
          }


          /*
            Add to queue
          */

          if (
            musicData.current
          ) {

            musicData.queue.push(
              song
            );

            return interaction.editReply(
              `➕ Added to queue: **${song.title}**`
            );
          }


          /*
            First song
          */

          const loadingEmbed =
            new EmbedBuilder()
              .setTitle(
                "🎧 Loading..."
              )
              .setDescription(
                `Searching and loading **${song.title}**`
              )
              .setColor(
                0xff007f
              );


          await interaction.editReply({
            embeds: [
              loadingEmbed
            ],
            components: []
          });


          musicData.message =
            await interaction.fetchReply();


          await playSong(
            interaction.guild.id,
            song
          );

          return;
        }


        /* CONNECT */

        if (
          command === "connect"
        ) {
          const voiceChannel =
            interaction.member.voice
              .channel;

          if (!voiceChannel) {
            return interaction.reply({
              content:
                "❌ Join a voice channel first.",
              flags:
                MessageFlags.Ephemeral
            });
          }

          let connection =
            getVoiceConnection(
              interaction.guild.id
            );

          if (!connection) {

            connection =
              joinVoiceChannel({
                channelId:
                  voiceChannel.id,

                guildId:
                  interaction.guild.id,

                adapterCreator:
                  interaction.guild
                    .voiceAdapterCreator,

                selfDeaf: true
              });

            try {
              await entersState(
                connection,
                VoiceConnectionStatus.Ready,
                30000
              );

            } catch {
              connection.destroy();

              return interaction.reply(
                "❌ Unable to connect."
              );
            }
          }

          let musicData =
            players.get(
              interaction.guild.id
            );

          if (!musicData) {
            createMusicPlayer(
              interaction.guild.id,
              connection
            );
          }

          return interaction.reply(
            `🎤 Connected to **${voiceChannel.name}**`
          );
        }


        /* DISCONNECT */

        if (
          command === "disconnect"
        ) {

          const musicData =
            players.get(
              interaction.guild.id
            );

          if (
            musicData?.updateInterval
          ) {
            clearInterval(
              musicData.updateInterval
            );
          }

          const connection =
            getVoiceConnection(
              interaction.guild.id
            );

          if (connection) {
            connection.destroy();
          }

          players.delete(
            interaction.guild.id
          );

          updateBotStatus(null);

          return interaction.reply(
            "👋 Disconnected from the voice channel."
          );
        }


        /* INVITE */

        if (
          command === "invite"
        ) {

          const inviteURL =
            `https://discord.com/oauth2/authorize?client_id=${CLIENT_ID}&permissions=8&scope=bot%20applications.commands`;

          const row =
            new ActionRowBuilder()
              .addComponents(

                new ButtonBuilder()
                  .setLabel(
                    "Add Bot"
                  )
                  .setStyle(
                    ButtonStyle.Link
                  )
                  .setURL(
                    inviteURL
                  )

              );

          return interaction.reply({
            content:
              "🔗 Add the bot to your server:",
            components: [
              row
            ]
          });
        }


        /* CLEAN */

        if (
          command === "clean"
        ) {

          try {

            const deleted =
              await interaction.channel.bulkDelete(
                100,
                true
              );

            return interaction.reply({
              content:
                `🧹 Deleted ${deleted.size} messages.`,
              flags:
                MessageFlags.Ephemeral
            });

          } catch {

            return interaction.reply({
              content:
                "❌ I could not delete messages.",
              flags:
                MessageFlags.Ephemeral
            });
          }
        }


        /* HELP */

        if (
          command === "help"
        ) {

          const embed =
            new EmbedBuilder()
              .setTitle(
                "📖 Music Bot Commands"
              )
              .setDescription(
                "`/play <song>` - Play or queue a song\n\n" +
                "`/connect` - Join your voice channel\n\n" +
                "`/disconnect` - Leave the voice channel\n\n" +
                "`/clean` - Delete messages\n\n" +
                "`/invite` - Get the bot invite link\n\n" +
                "`/help` - Show this menu\n\n" +
                "**Buttons:**\n" +
                "⏯️ Pause / Resume\n" +
                "⏩ Skip\n" +
                "🔊 Volume\n" +
                "🔁 Loop"
              )
              .setColor(
                0x00ff7f
              );

          return interaction.reply({
            embeds: [
              embed
            ]
          });
        }
      }


      /* =====================
         BUTTONS
      ===================== */

      if (
        interaction.isButton()
      ) {

        const musicData =
          players.get(
            interaction.guild?.id
          );

        if (
          !musicData ||
          !musicData.current
        ) {

          return interaction.reply({
            content:
              "❌ No song is playing.",
            flags:
              MessageFlags.Ephemeral
          });
        }


        /* PAUSE / RESUME */

        if (
          interaction.customId ===
          "pause_resume"
        ) {

          if (
            musicData.player.state
              .status ===
            AudioPlayerStatus.Paused
          ) {

            musicData.player.unpause();

            await interaction.reply({
              content:
                "▶️ Resumed.",
              flags:
                MessageFlags.Ephemeral
            });

          } else {

            musicData.player.pause();

            await interaction.reply({
              content:
                "⏸️ Paused.",
              flags:
                MessageFlags.Ephemeral
            });
          }

          return;
        }


        /* SKIP */

        if (
          interaction.customId ===
          "skip"
        ) {

          await interaction.reply({
            content:
              "⏩ Skipped.",
            flags:
              MessageFlags.Ephemeral
          });

          musicData.player.stop();

          return;
        }


        /* LOOP */

        if (
          interaction.customId ===
          "loop"
        ) {

          musicData.loop =
            !musicData.loop;

          await updateMusicMessage(
            musicData
          );

          return interaction.reply({
            content:
              musicData.loop
                ? "🔁 Loop enabled."
                : "🔁 Loop disabled.",
            flags:
              MessageFlags.Ephemeral
          });
        }


        /* VOLUME */

        if (
          interaction.customId ===
          "volume"
        ) {

          const modal =
            new ModalBuilder()
              .setCustomId(
                "volume_modal"
              )
              .setTitle(
                "Change Volume"
              );

          const input =
            new TextInputBuilder()
              .setCustomId(
                "volume_input"
              )
              .setLabel(
                "Volume (1 - 100)"
              )
              .setStyle(
                TextInputStyle.Short
              )
              .setPlaceholder(
                "50"
              )
              .setRequired(
                true
              );

          const row =
            new ActionRowBuilder()
              .addComponents(
                input
              );

          modal.addComponents(
            row
          );

          return interaction.showModal(
            modal
          );
        }
      }


      /* =====================
         VOLUME MODAL
      ===================== */

      if (
        interaction.isModalSubmit()
      ) {

        if (
          interaction.customId ===
          "volume_modal"
        ) {

          const value =
            Number(
              interaction.fields.getTextInputValue(
                "volume_input"
              )
            );

          if (
            !Number.isInteger(value) ||
            value < 1 ||
            value > 100
          ) {

            return interaction.reply({
              content:
                "❌ Enter a number between 1 and 100.",
              flags:
                MessageFlags.Ephemeral
            });
          }


          const musicData =
            players.get(
              interaction.guild?.id
            );

          if (
            !musicData
          ) {

            return interaction.reply({
              content:
                "❌ No active player.",
              flags:
                MessageFlags.Ephemeral
            });
          }


          musicData.volume =
            value / 100;


          if (
            musicData.resource?.volume
          ) {

            musicData.resource.volume.setVolume(
              musicData.volume
            );
          }


          await updateMusicMessage(
            musicData
          );


          return interaction.reply({
            content:
              `🔊 Volume changed to ${value}%.`,
            flags:
              MessageFlags.Ephemeral
          });
        }
      }

    } catch (error) {

      console.error(
        "Interaction error:",
        error
      );

      if (
        interaction.isRepliable()
      ) {

        if (
          interaction.replied ||
          interaction.deferred
        ) {

          await interaction
            .followUp({
              content:
                "❌ An error occurred.",
              flags:
                MessageFlags.Ephemeral
            })
            .catch(() => {});

        } else {

          await interaction
            .reply({
              content:
                "❌ An error occurred.",
              flags:
                MessageFlags.Ephemeral
            })
            .catch(() => {});
        }
      }
    }
  }
);


/* =========================
   LOGIN
========================= */

client.login(TOKEN);
