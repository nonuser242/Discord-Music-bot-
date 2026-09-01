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
  MessageFlags,
  ActivityType,
  PermissionFlagsBits
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


// ================================
// CONFIG
// ================================

const TOKEN = process.env.TOKEN;
const CLIENT_ID = process.env.CLIENT_ID || "1543273003822092469";

if (!TOKEN) {
  console.error("❌ TOKEN Environment Variable lama helin!");
  process.exit(1);
}


// ================================
// DISCORD CLIENT
// ================================

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildVoiceStates
  ]
});


// Server walba Music gaar ah
const players = new Map();


// ================================
// COMMANDS
// ================================

const commands = [

  new SlashCommandBuilder()
    .setName("play")
    .setDescription("Ku daar hees Voice Call-ka.")
    .addStringOption(option =>
      option
        .setName("song")
        .setDescription("Magaca heesta ama YouTube Link")
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("connect")
    .setDescription("Bot-ka geli Voice Call-ka."),

  new SlashCommandBuilder()
    .setName("disconnect")
    .setDescription("Bot-ka ka saar Voice Call-ka."),

  new SlashCommandBuilder()
    .setName("skip")
    .setDescription("Ka gudub heesta hadda socota."),

  new SlashCommandBuilder()
    .setName("invite")
    .setDescription("Hel linkiga Bot-ka."),

  new SlashCommandBuilder()
    .setName("clean")
    .setDescription("Tirtir fariimaha kanaalka.")
    .setDefaultMemberPermissions(
      PermissionFlagsBits.ManageMessages
    ),

  new SlashCommandBuilder()
    .setName("help")
    .setDescription("Eeg dhammaan amarrada Bot-ka.")

].map(command => command.toJSON());


// ================================
// TIME FUNCTIONS
// ================================

function formatMs(ms) {

  const totalSeconds = Math.floor(ms / 1000);

  const minutes = Math.floor(totalSeconds / 60);

  const seconds = totalSeconds % 60;

  return `${minutes}:${seconds
    .toString()
    .padStart(2, "0")}`;

}


function durationToMs(duration) {

  if (!duration) return 0;

  const parts = duration
    .split(":")
    .map(Number);

  if (parts.some(isNaN)) return 0;

  if (parts.length === 2) {

    return (
      parts[0] * 60 +
      parts[1]
    ) * 1000;

  }

  if (parts.length === 3) {

    return (
      parts[0] * 3600 +
      parts[1] * 60 +
      parts[2]
    ) * 1000;

  }

  return 0;

}


// ================================
// PROGRESS BAR
// ================================

function createProgressBar(currentMs, duration) {

  const totalMs =
    durationToMs(duration);

  if (!totalMs) {

    return "`🔘▬▬▬▬▬▬▬▬▬▬`";

  }

  const progress =
    Math.min(
      Math.max(
        currentMs / totalMs,
        0
      ),
      1
    );

  const size = 12;

  const position =
    Math.round(
      progress * size
    );

  let bar = "";

  for (
    let i = 0;
    i <= size;
    i++
  ) {

    if (i === position) {

      bar += "🔘";

    } else {

      bar += "▬";

    }

  }

  return (
    `\`${bar}\`\n` +
    `\`${formatMs(currentMs)} / ${duration}\``
  );

}


// ================================
// MUSIC EMBED
// ================================

function createMusicEmbed(
  musicData,
  ended = false
) {

  const song =
    musicData.current;

  if (!song) return null;

  const playback =
    musicData.resource
      ?.playbackDuration || 0;

  const progress =
    ended
      ? `\`▬▬▬▬▬▬▬▬▬▬▬▬🔘\`\n\`${song.duration} / ${song.duration}\``
      : createProgressBar(
          playback,
          song.duration
        );

  const volume =
    Math.round(
      musicData.volume * 100
    );

  const loop =
    musicData.loop
      ? "ON 🔁"
      : "OFF";

  const queueCount =
    musicData.queue.length;

  const embed =
    new EmbedBuilder()

      .setTitle(
        ended
          ? "🏁 HEESTU WAY DHAMMAATAY"
          : "🎧 NOW PLAYING"
      )

      .setDescription(

        `🎵 **[${song.title}](${song.url})**\n\n` +

        `⏱️ ${progress}\n\n` +

        `🔊 Volume: **${volume}%**\n` +

        `🔁 Loop: **${loop}**\n` +

        `📜 Queue: **${queueCount}** hees\n\n` +

        (
          ended
            ? "🏁 Heestii way dhamaatay. Bot-ku Call-ka wuu ku sii jiraa."
            : "🎶 Music Playing..."
        )

      )

      .setColor(
        ended
          ? "#ff0000"
          : "#ff007f"
      );

  if (song.thumbnail) {

    embed.setThumbnail(
      song.thumbnail
    );

  }

  return embed;

}


// ================================
// BUTTONS
// ================================

function createMusicButtons() {

  const row1 =
    new ActionRowBuilder()
      .addComponents(

        new ButtonBuilder()
          .setCustomId(
            "previous_btn"
          )
          .setEmoji("⏪")
          .setStyle(
            ButtonStyle.Secondary
          ),

        new ButtonBuilder()
          .setCustomId(
            "pause_resume_btn"
          )
          .setEmoji("⏯️")
          .setStyle(
            ButtonStyle.Primary
          ),

        new ButtonBuilder()
          .setCustomId(
            "skip_song_btn"
          )
          .setEmoji("⏩")
          .setStyle(
            ButtonStyle.Secondary
          ),

        new ButtonBuilder()
          .setCustomId(
            "loop_toggle_btn"
          )
          .setEmoji("🔁")
          .setStyle(
            ButtonStyle.Secondary
          ),

        new ButtonBuilder()
          .setCustomId(
            "volume_modal_btn"
          )
          .setEmoji("🔊")
          .setStyle(
            ButtonStyle.Success
          )

      );

  return [row1];

}


// ================================
// UPDATE MESSAGE
// ================================

async function updateMusicMessage(
  musicData
) {

  if (
    !musicData.message ||
    !musicData.current
  ) return;

  try {

    const embed =
      createMusicEmbed(
        musicData
      );

    await musicData.message.edit({

      embeds: [embed],

      components:
        createMusicButtons()

    });

  } catch (error) {

    // Message edit error ignore

  }

}


// ================================
// PLAY SONG
// ================================

async function playSong(
  guildId,
  song
) {

  const musicData =
    players.get(guildId);

  if (
    !musicData ||
    !song
  ) return;

  try {

    musicData.current =
      song;

    console.log(
      "🎵 Playing:",
      song.url
    );


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

          inlineVolume:
            true

        }
      );


    resource.volume
      ?.setVolume(
        musicData.volume
      );


    musicData.resource =
      resource;


    musicData.player.play(
      resource
    );


    if (
      musicData.message
    ) {

      await updateMusicMessage(
        musicData
      );

    }


    if (
      musicData.updateInterval
    ) {

      clearInterval(
        musicData.updateInterval
      );

    }


    musicData.updateInterval =
      setInterval(() => {

        if (
          musicData.player.state.status ===
          AudioPlayerStatus.Playing
        ) {

          updateMusicMessage(
            musicData
          ).catch(() => {});

        }

      }, 5000);


  } catch (error) {

    console.error(
      "❌ PLAY ERROR:",
      error
    );


    musicData.current =
      null;


    musicData.resource =
      null;


    playNext(
      guildId
    );

  }

}


// ================================
// NEXT SONG
// ================================

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


  // Skip haddii la codsaday
  const skipped =
    musicData.skipRequested;


  musicData.skipRequested =
    false;


  // Loop
  if (
    musicData.loop &&
    musicData.current &&
    !skipped
  ) {

    return playSong(
      guildId,
      musicData.current
    );

  }


  // Queue
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


  // Music dhammaatay laakiin
  // BOT-KA CALL-KA HA KA BIXIN

  musicData.current =
    null;

  musicData.resource =
    null;


  if (
    musicData.message
  ) {

    try {

      const oldSong =
        musicData.lastSong;

      if (oldSong) {

        const embed =
          new EmbedBuilder()

            .setTitle(
              "🏁 MUSIC FINISHED"
            )

            .setDescription(
              `🎵 **${oldSong.title}**\n\n` +
              "Bot-ku Voice Call-ka wuu ku sii jiraa.\n" +
              "Isticmaal `/disconnect` si aad uga saarto."
            )

            .setColor(
              "#ff0000"
            );

        await musicData.message.edit({

          embeds: [embed],

          components: []

        });

      }

    } catch (error) {}

  }

}


// ================================
// CREATE PLAYER
// ================================

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

    resource: null,

    current: null,

    lastSong: null,

    queue: [],

    volume: 1,

    loop: false,

    message: null,

    updateInterval: null,

    skipRequested: false

  };


  players.set(
    guildId,
    musicData
  );


  player.on(
    AudioPlayerStatus.Idle,
    async () => {

      if (
        musicData.current
      ) {

        musicData.lastSong =
          musicData.current;

      }

      await playNext(
        guildId
      );

    }
  );


  player.on(
    "error",
    error => {

      console.error(
        "AUDIO ERROR:",
        error
      );

    }
  );


  return musicData;

}


// ================================
// READY
// ================================

client.once(
  "ready",
  async () => {

    console.log(
      `✅ Bot Online: ${client.user.tag}`
    );


    client.user.setActivity(
      "/play | Music",
      {

        type:
          ActivityType.Listening

      }
    );


    const rest =
      new REST({
        version: "10"
      })
      .setToken(
        TOKEN
      );


    try {

      await rest.put(

        Routes.applicationCommands(
          CLIENT_ID
        ),

        {
          body:
            commands
        }

      );


      console.log(
        "✅ Slash Commands Loaded!"
      );

    } catch (error) {

      console.error(
        "COMMAND ERROR:",
        error
      );

    }

  }
);


// ================================
// INTERACTIONS
// ================================

client.on(
  "interactionCreate",
  async interaction => {

    try {


      // ==========================
      // SLASH COMMANDS
      // ==========================

      if (
        interaction.isChatInputCommand()
      ) {

        const {
          commandName
        } = interaction;


        // ----------------------
        // PLAY
        // ----------------------

        if (
          commandName === "play"
        ) {

          const songQuery =
            interaction.options
              .getString("song")
              ?.trim();


          const voiceChannel =
            interaction.member.voice
              .channel;


          if (
            !voiceChannel
          ) {

            return interaction.reply({

              content:
                "❌ Horta gal Voice Call!",

              flags:
                MessageFlags.Ephemeral

            });

          }


          await interaction.deferReply();


          let song;


          const validation =
            await play.validate(
              songQuery
            );


          // YouTube URL
          if (
            validation ===
            "yt_video"
          ) {

            const info =
              await play.video_info(
                songQuery
              );


            song = {

              title:
                info.video_details.title,

              url:
                info.video_details.url,

              thumbnail:
                info.video_details
                  .thumbnails
                  ?.at(-1)
                  ?.url || "",

              duration:
                info.video_details
                  .durationRaw ||
                "Unknown"

            };


          } else {


            console.log(
              "🔎 Searching YouTube..."
            );


            const results =
              await play.search(
                songQuery,
                {
                  limit: 1,

                  source: {
                    youtube:
                      "video"
                  }
                }
              );


            if (
              !results ||
              results.length === 0
            ) {

              return interaction.editReply(
                "❌ Hees lama helin!"
              );

            }


            const video =
              results[0];


            song = {

              title:
                video.title,

              url:
                video.url,

              thumbnail:
                video.thumbnails
                  ?.at(-1)
                  ?.url || "",

              duration:
                video.durationRaw ||
                "Unknown"

            };

          }


          let connection =
            getVoiceConnection(
              interaction.guild.id
            );


          // Haddii bot-ku channel kale ku jiro
          if (
            connection &&
            connection.joinConfig.channelId !==
            voiceChannel.id
          ) {

            connection.destroy();

            connection = null;

          }


          // Samee Connection
          if (
            !connection
          ) {

            connection =
              joinVoiceChannel({

                channelId:
                  voiceChannel.id,

                guildId:
                  interaction.guild.id,

                adapterCreator:
                  interaction.guild
                    .voiceAdapterCreator,

                selfDeaf:
                  true

              });


            await entersState(

              connection,

              VoiceConnectionStatus.Ready,

              30000

            );

          }


          let musicData =
            players.get(
              interaction.guild.id
            );


          if (
            !musicData
          ) {

            musicData =
              createMusicPlayer(

                interaction.guild.id,

                connection

              );


            connection.subscribe(
              musicData.player
            );

          }


          // Haddii hees socoto
          if (
            musicData.current
          ) {

            musicData.queue.push(
              song
            );


            return interaction.editReply(
              `➕ **${song.title}** safka ayaa lagu daray!`
            );

          }


          // Samee Message marka hore
          const loadingEmbed =
            new EmbedBuilder()

              .setTitle(
                "🔄 Loading Music..."
              )

              .setDescription(
                `🎵 **${song.title}**`
              )

              .setColor(
                "#ff007f"
              );


          await interaction.editReply({

            embeds:
              [loadingEmbed]

          });


          musicData.message =
            await interaction.fetchReply();


          await playSong(

            interaction.guild.id,

            song

          );


          await updateMusicMessage(
            musicData
          );

        }


        // ----------------------
        // CONNECT
        // ----------------------

        else if (
          commandName ===
          "connect"
        ) {

          const voiceChannel =
            interaction.member
              .voice.channel;


          if (
            !voiceChannel
          ) {

            return interaction.reply({

              content:
                "❌ Horta gal Voice Call!",

              flags:
                MessageFlags.Ephemeral

            });

          }


          let connection =
            getVoiceConnection(
              interaction.guild.id
            );


          if (
            connection
          ) {

            connection.destroy();

          }


          connection =
            joinVoiceChannel({

              channelId:
                voiceChannel.id,

              guildId:
                interaction.guild.id,

              adapterCreator:
                interaction.guild
                  .voiceAdapterCreator,

              selfDeaf:
                true

            });


          await interaction.reply(
            `🎤 Bot-ku wuxuu galay **${voiceChannel.name}**`
          );

        }


        // ----------------------
        // DISCONNECT
        // ----------------------

        else if (
          commandName ===
          "disconnect"
        ) {

          const connection =
            getVoiceConnection(
              interaction.guild.id
            );


          if (
            connection
          ) {

            connection.destroy();

          }


          const musicData =
            players.get(
              interaction.guild.id
            );


          if (
            musicData
              ?.updateInterval
          ) {

            clearInterval(
              musicData.updateInterval
            );

          }


          players.delete(
            interaction.guild.id
          );


          return interaction.reply(
            "👋 Bot-ku wuxuu ka baxay Voice Call-ka."
          );

        }


        // ----------------------
        // SKIP
        // ----------------------

        else if (
          commandName ===
          "skip"
        ) {

          const musicData =
            players.get(
              interaction.guild.id
            );


          if (
            !musicData ||
            !musicData.current
          ) {

            return interaction.reply({

              content:
                "❌ Wax hees ah ma socoto!",

              flags:
                MessageFlags.Ephemeral

            });

          }


          musicData.skipRequested =
            true;


          musicData.player.stop();


          return interaction.reply(
            "⏩ Heesta waa la dhaafay!"
          );

        }


        // ----------------------
        // INVITE
        // ----------------------

        else if (
          commandName ===
          "invite"
        ) {

          const inviteUrl =
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
                    inviteUrl
                  )

              );


          return interaction.reply({

            content:
              "🔗 Ku dar Bot-ka Server-kaaga:",

            components:
              [row]

          });

        }


        // ----------------------
        // CLEAN
        // ----------------------

        else if (
          commandName ===
          "clean"
        ) {

          await interaction.channel
            .bulkDelete(
              100,
              true
            )
            .catch(() => {});


          return interaction.reply({

            content:
              "🧹 Channel-ka waa la nadiifiyay!",

            flags:
              MessageFlags.Ephemeral

          });

        }


        // ----------------------
        // HELP
        // ----------------------

        else if (
          commandName ===
          "help"
        ) {

          const embed =
            new EmbedBuilder()

              .setTitle(
                "📖 BOT HELP"
              )

              .setDescription(

                "`/play <song>` 🎵 - Daar hees\n\n" +

                "`/connect` 🎤 - Bot-ka geli Call\n\n" +

                "`/disconnect` 👋 - Bot-ka ka saar Call\n\n" +

                "`/skip` ⏩ - Dhaaf heesta\n\n" +

                "`/clean` 🧹 - Tirtir fariimaha\n\n" +

                "`/invite` 🔗 - Ku dar Bot Server kale\n\n" +

                "🎛️ Buttons:\n" +

                "⏪ Previous\n" +
                "⏯️ Pause / Resume\n" +
                "⏩ Skip\n" +
                "🔁 Loop\n" +
                "🔊 Volume"

              )

              .setColor(
                "#ff007f"
              );


          return interaction.reply({

            embeds:
              [embed]

          });

        }

      }


      // ==========================
      // BUTTONS
      // ==========================

      if (
        interaction.isButton()
      ) {

        const musicData =
          players.get(
            interaction.guild.id
          );


        if (
          !musicData ||
          !musicData.current
        ) {

          return interaction.reply({

            content:
              "❌ Wax hees ah ma socoto!",

            flags:
              MessageFlags.Ephemeral

          });

        }


        // Pause / Resume
        if (
          interaction.customId ===
          "pause_resume_btn"
        ) {

          if (
            musicData.player
              .state.status ===
            AudioPlayerStatus.Playing
          ) {

            musicData.player.pause();

            return interaction.reply({

              content:
                "⏸️ Heesta waa la hakiyay.",

              flags:
                MessageFlags.Ephemeral

            });

          }


          musicData.player.unpause();


          return interaction.reply({

            content:
              "▶️ Heesta waa la sii waday.",

            flags:
              MessageFlags.Ephemeral

          });

        }


        // Skip
        if (
          interaction.customId ===
          "skip_song_btn"
        ) {

          musicData.skipRequested =
            true;


          musicData.player.stop();


          return interaction.reply({

            content:
              "⏩ Heesta waa la dhaafay!",

            flags:
              MessageFlags.Ephemeral

          });

        }


        // Loop
        if (
          interaction.customId ===
          "loop_toggle_btn"
        ) {

          musicData.loop =
            !musicData.loop;


          await updateMusicMessage(
            musicData
          );


          return interaction.reply({

            content:
              musicData.loop
                ? "🔁 Loop waa ON"
                : "🔁 Loop waa OFF",

            flags:
              MessageFlags.Ephemeral

          });

        }


        // Previous
        if (
          interaction.customId ===
          "previous_btn"
        ) {

          return interaction.reply({

            content:
              "⏪ Previous feature-ka wuxuu u baahan yahay song history; hadda safka ayaa lagu shaqaynayaa.",

            flags:
              MessageFlags.Ephemeral

          });

        }


        // Volume Modal
        if (
          interaction.customId ===
          "volume_modal_btn"
        ) {

          const modal =
            new ModalBuilder()

              .setCustomId(
                "volume_modal"
              )

              .setTitle(
                "Beddel Volume"
              );


          const input =
            new TextInputBuilder()

              .setCustomId(
                "volume_input"
              )

              .setLabel(
                "Volume 1 ilaa 100"
              )

              .setStyle(
                TextInputStyle.Short
              )

              .setPlaceholder(
                "100"
              )

              .setRequired(
                true
              );


          modal.addComponents(

            new ActionRowBuilder()
              .addComponents(
                input
              )

          );


          return interaction.showModal(
            modal
          );

        }

      }


      // ==========================
      // MODAL
      // ==========================

      if (
        interaction.isModalSubmit()
      ) {

        if (
          interaction.customId ===
          "volume_modal"
        ) {

          const value =
            parseInt(

              interaction.fields
                .getTextInputValue(
                  "volume_input"
                )

            );


          if (
            isNaN(value) ||
            value < 1 ||
            value > 100
          ) {

            return interaction.reply({

              content:
                "❌ Geli Volume 1 ilaa 100!",

              flags:
                MessageFlags.Ephemeral

            });

          }


          const musicData =
            players.get(
              interaction.guild.id
            );


          if (
            !musicData
          ) {

            return interaction.reply({

              content:
                "❌ Wax hees ah ma socoto!",

              flags:
                MessageFlags.Ephemeral

            });

          }


          musicData.volume =
            value / 100;


          if (
            musicData.resource
              ?.volume
          ) {

            musicData.resource.volume
              .setVolume(
                musicData.volume
              );

          }


          await updateMusicMessage(
            musicData
          );


          return interaction.reply({

            content:
              `🔊 Volume waxaa loo beddelay **${value}%**`,

            flags:
              MessageFlags.Ephemeral

          });

        }

      }

    } catch (error) {

      console.error(
        "❌ ERROR:",
        error
      );


      if (
        interaction.deferred
      ) {

        await interaction.editReply(
          "❌ Khalad ayaa dhacay!"
        ).catch(() => {});

      }

      else if (
        !interaction.replied
      ) {

        await interaction.reply({

          content:
            "❌ Khalad ayaa dhacay!",

          flags:
            MessageFlags.Ephemeral

        }).catch(() => {});

      }

    }

  }
);


// ================================
// LOGIN
// ================================

client.login(TOKEN);
