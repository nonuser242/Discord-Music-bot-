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
} = require("discord.js");

const {
  joinVoiceChannel,
  createAudioPlayer,
  createAudioResource,
  AudioPlayerStatus,
  VoiceConnectionStatus,
  entersState,
  getVoiceConnection,
  NoSubscriberBehavior,
} = require("@discordjs/voice");

const play = require("@iamtraction/play-dl");

/*
  Kinesis Environment Variables:

  TOKEN = Your new Discord bot token
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
    GatewayIntentBits.GuildVoiceStates,
  ],
});

/*
  Every Discord server gets its own music player.
*/

const players = new Map();


/* =========================
   SLASH COMMANDS
========================= */

const commands = [

  new SlashCommandBuilder()
    .setName("play")
    .setDescription("Play music in your voice channel.")
    .addStringOption(option =>
      option
        .setName("song")
        .setDescription("Song name or YouTube URL")
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("connect")
    .setDescription("Connect the bot to your voice channel."),

  new SlashCommandBuilder()
    .setName("disconnect")
    .setDescription("Disconnect the bot from voice."),

  new SlashCommandBuilder()
    .setName("skip")
    .setDescription("Skip the current song."),

  new SlashCommandBuilder()
    .setName("pause")
    .setDescription("Pause the current song."),

  new SlashCommandBuilder()
    .setName("resume")
    .setDescription("Resume the current song."),

  new SlashCommandBuilder()
    .setName("volume")
    .setDescription("Change the music volume.")
    .addIntegerOption(option =>
      option
        .setName("amount")
        .setDescription("Volume from 1 to 100")
        .setRequired(true)
        .setMinValue(1)
        .setMaxValue(100)
    ),

  new SlashCommandBuilder()
    .setName("loop")
    .setDescription("Turn song loop on or off."),

  new SlashCommandBuilder()
    .setName("invite")
    .setDescription("Get the bot invite link."),

  new SlashCommandBuilder()
    .setName("help")
    .setDescription("Show all bot commands."),

].map(command => command.toJSON());


/* =========================
   FUNCTIONS
========================= */

function formatTime(ms) {

  if (!ms || ms < 0) return "0:00";

  const totalSeconds = Math.floor(ms / 1000);

  const minutes = Math.floor(totalSeconds / 60);

  const seconds = totalSeconds % 60;

  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}


function durationToMs(duration) {

  if (!duration || typeof duration !== "string") {
    return 0;
  }

  const parts = duration.split(":").map(Number);

  if (parts.some(isNaN)) return 0;

  let seconds = 0;

  if (parts.length === 3) {

    seconds =
      parts[0] * 3600 +
      parts[1] * 60 +
      parts[2];

  } else if (parts.length === 2) {

    seconds =
      parts[0] * 60 +
      parts[1];

  } else {

    seconds = parts[0];

  }

  return seconds * 1000;
}


function createProgressBar(currentMs, duration) {

  const totalMs = durationToMs(duration);

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
    `\`${formatTime(currentMs)} / ${duration}\``
  );
}


/* =========================
   MUSIC EMBED
========================= */

function createMusicEmbed(data) {

  if (!data.current) return null;

  const song = data.current;

  const playback =
    data.resource?.playbackDuration || 0;

  const progress =
    createProgressBar(
      playback,
      song.duration
    );

  const volume =
    Math.round(data.volume * 100);

  const loopStatus =
    data.loop ? "ON 🔁" : "OFF";

  const status =
    data.player.state.status === AudioPlayerStatus.Paused
      ? "⏸️ PAUSED"
      : "▶️ NOW PLAYING";

  const embed = new EmbedBuilder()

    .setTitle(`🎵 ${status}`)

    .setDescription(

      `**[${song.title}](${song.url})**

${progress}

🔊 **Volume:** \`${volume}%\`

🔁 **Loop:** \`${loopStatus}\``

    )

    .setColor("#ff007f");

  if (song.thumbnail) {

    embed.setThumbnail(song.thumbnail);

  }

  return embed;
}


/* =========================
   BUTTONS
========================= */

function createButtons() {

  return [

    new ActionRowBuilder()
      .addComponents(

        new ButtonBuilder()
          .setCustomId("skip")
          .setLabel("Skip")
          .setEmoji("⏩")
          .setStyle(ButtonStyle.Secondary),

        new ButtonBuilder()
          .setCustomId("pause_resume")
          .setLabel("Pause / Resume")
          .setEmoji("⏯️")
          .setStyle(ButtonStyle.Primary),

        new ButtonBuilder()
          .setCustomId("volume")
          .setLabel("Volume")
          .setEmoji("🔊")
          .setStyle(ButtonStyle.Success),

        new ButtonBuilder()
          .setCustomId("loop")
          .setLabel("Loop")
          .setEmoji("🔁")
          .setStyle(ButtonStyle.Secondary),

      )

  ];

}


/* =========================
   UPDATE MESSAGE
========================= */

async function updateMusicMessage(data) {

  if (!data.message) return;

  if (!data.current) return;

  try {

    const embed =
      createMusicEmbed(data);

    if (!embed) return;

    await data.message.edit({

      embeds: [embed],

      components:
        createButtons(),

    });

  } catch (error) {

    console.error(
      "MESSAGE UPDATE ERROR:",
      error.message
    );

  }

}


/* =========================
   CREATE PLAYER
========================= */

function createPlayer(
  guildId,
  connection
) {

  const player =
    createAudioPlayer({

      behaviors: {

        noSubscriber:
          NoSubscriberBehavior.Play,

      },

    });


  const data = {

    player,

    connection,

    resource: null,

    current: null,

    queue: [],

    volume: 0.5,

    loop: false,

    message: null,

    updateInterval: null,

    channel: null,

  };


  players.set(
    guildId,
    data
  );


  player.on(
    AudioPlayerStatus.Idle,

    async () => {

      const music =
        players.get(guildId);

      if (!music) return;


      if (
        music.loop &&
        music.current
      ) {

        await playSong(
          guildId,
          music.current
        );

        return;

      }


      if (
        music.queue.length > 0
      ) {

        const nextSong =
          music.queue.shift();

        await playSong(
          guildId,
          nextSong
        );

      } else {

        music.current = null;

        music.resource = null;


        if (
          music.updateInterval
        ) {

          clearInterval(
            music.updateInterval
          );

          music.updateInterval = null;

        }


        /*
          IMPORTANT:
          Bot stays connected.
        */

        if (music.message) {

          try {

            await music.message.edit({

              content:
                "🏁 **Queue finished.**\n\nThe bot is still connected to the voice channel.",

              embeds: [],

              components: [],

            });

          } catch {}

        }

      }

    }

  );


  player.on(
    "error",

    error => {

      console.error(
        "AUDIO PLAYER ERROR:",
        error.message
      );

    }

  );


  return data;

}


/* =========================
   PLAY SONG
========================= */

async function playSong(
  guildId,
  song
) {

  const data =
    players.get(guildId);

  if (!data) return;


  try {

    data.current = song;


    console.log(
      `▶ Playing: ${song.title}`
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
            true,

        }
      );


    resource.volume?.setVolume(
      data.volume
    );


    data.resource =
      resource;


    data.player.play(
      resource
    );


    await updateMusicMessage(
      data
    );


    if (
      data.updateInterval
    ) {

      clearInterval(
        data.updateInterval
      );

    }


    data.updateInterval =
      setInterval(() => {

        if (
          data.current &&
          data.message
        ) {

          updateMusicMessage(
            data
          ).catch(() => {});

        }

      }, 2000);


  } catch (error) {

    console.error(
      "PLAY ERROR:",
      error
    );


    if (
      data.channel
    ) {

      data.channel.send(
        "❌ I couldn't play this song. Try another YouTube video or song."
      ).catch(() => {});

    }


    /*
      Try next song.
    */

    if (
      data.queue.length > 0
    ) {

      const next =
        data.queue.shift();

      await playSong(
        guildId,
        next
      );

    } else {

      data.current = null;

    }

  }

}


/* =========================
   FIND SONG
========================= */

async function findSong(query) {

  let results;


  if (
    query.startsWith(
      "https://"
    ) ||
    query.startsWith(
      "http://"
    )
  ) {

    const info =
      await play.video_basic_info(
        query
      );

    const video =
      info.video_details;


    return {

      title:
        video.title,

      url:
        video.url,

      thumbnail:
        video.thumbnails?.at(-1)?.url ||
        "",

      duration:
        video.durationRaw ||
        video.durationInSec
          ? `${Math.floor(video.durationInSec / 60)}:${String(video.durationInSec % 60).padStart(2, "0")}`
          : "Unknown",

    };

  }


  results =
    await play.search(
      query,
      {

        limit: 1,

        source: {

          youtube: "video",

        },

      }
    );


  if (
    !results ||
    results.length === 0
  ) {

    return null;

  }


  const video =
    results[0];


  return {

    title:
      video.title ||
      "Unknown Song",

    url:
      video.url,

    thumbnail:
      video.thumbnails?.at(-1)?.url ||
      "",

    duration:
      video.durationRaw ||
      "Unknown",

  };

}


/* =========================
   READY
========================= */

client.once(
  "clientReady",

  async () => {

    console.log(
      `✅ Bot Online: ${client.user.tag}`
    );


    client.user.setActivity(
      "/play | Music",
      {

        type:
          ActivityType.Listening,

      }
    );


    const rest =
      new REST({

        version: "10",

      }).setToken(TOKEN);


    try {

      console.log(
        "🔄 Loading slash commands..."
      );


      await rest.put(

        Routes.applicationCommands(
          CLIENT_ID
        ),

        {

          body:
            commands,

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


/* =========================
   INTERACTIONS
========================= */

client.on(
  "interactionCreate",

  async interaction => {

    try {


      /* =========================
         SLASH COMMANDS
      ========================= */

      if (
        interaction.isChatInputCommand()
      ) {

        const command =
          interaction.commandName;


        /*
          HELP
          Works in DM and Server
        */

        if (
          command === "help"
        ) {

          const embed =
            new EmbedBuilder()

              .setTitle(
                "📖 Music Bot Help"
              )

              .setDescription(

`🎵 **Music Commands**

\`/play <song>\`
Play a song or add it to the queue.

\`/connect\`
Connect the bot to your voice channel.

\`/disconnect\`
Disconnect the bot.

\`/skip\`
Skip the current song.

\`/pause\`
Pause the song.

\`/resume\`
Resume the song.

\`/volume <1-100>\`
Change the music volume.

\`/loop\`
Turn loop on or off.

\`/invite\`
Get the bot invite link.

---

🎛️ **Buttons**

⏩ Skip  
⏯️ Pause / Resume  
🔊 Volume  
🔁 Loop

🏁 When the queue finishes, the bot stays connected to the voice channel.`

              )

              .setColor(
                "#00ff7f"
              );


          return interaction.reply({

            embeds: [embed],

          });

        }


        /*
          INVITE
          Works in DM and Server
        */

        if (
          command === "invite"
        ) {

          const inviteUrl =
            `https://discord.com/oauth2/authorize?client_id=${CLIENT_ID}&permissions=8&scope=bot%20applications.commands`;


          const row =
            new ActionRowBuilder()

              .addComponents(

                new ButtonBuilder()

                  .setLabel(
                    "Add Bot to Discord"
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
              "🔗 **Invite the bot to your Discord server:**",

            components:
              [row],

          });

        }


        /*
          Other commands require server
        */

        if (
          !interaction.guild
        ) {

          return interaction.reply({

            content:
              "❌ Music commands can only be used inside a Discord server.",

            flags:
              MessageFlags.Ephemeral,

          });

        }


        const guildId =
          interaction.guild.id;


        /*
          PLAY
        */

        if (
          command === "play"
        ) {

          const voiceChannel =
            interaction.member.voice.channel;


          if (!voiceChannel) {

            return interaction.reply({

              content:
                "❌ Join a voice channel first!",

              flags:
                MessageFlags.Ephemeral,

            });

          }


          await interaction.deferReply();


          const query =
            interaction.options.getString(
              "song"
            );


          let song;


          try {

            song =
              await findSong(
                query
              );

          } catch (error) {

            console.error(
              "SEARCH ERROR:",
              error
            );


            return interaction.editReply(
              "❌ Failed to search YouTube. Please try another song."
            );

          }


          if (!song) {

            return interaction.editReply(
              "❌ No song found."
            );

          }


          let connection =
            getVoiceConnection(
              guildId
            );


          if (!connection) {

            connection =
              joinVoiceChannel({

                channelId:
                  voiceChannel.id,

                guildId,

                adapterCreator:
                  interaction.guild.voiceAdapterCreator,

                selfDeaf:
                  true,

              });


            await entersState(

              connection,

              VoiceConnectionStatus.Ready,

              30000

            );

          }


          let data =
            players.get(
              guildId
            );


          if (!data) {

            data =
              createPlayer(
                guildId,
                connection
              );


            connection.subscribe(
              data.player
            );

          }


          data.connection =
            connection;


          data.channel =
            interaction.channel;


          if (
            data.current
          ) {

            data.queue.push(
              song
            );


            return interaction.editReply(
              `➕ **${song.title}** added to the queue.`
            );

          }


          data.current =
            song;


          const embed =
            createMusicEmbed(
              data
            );


          await interaction.editReply({

            embeds:
              embed
                ? [embed]
                : [],

            components:
              createButtons(),

          });


          data.message =
            await interaction.fetchReply();


          await playSong(
            guildId,
            song
          );


          return;

        }


        /*
          CONNECT
        */

        if (
          command === "connect"
        ) {

          const voiceChannel =
            interaction.member.voice.channel;


          if (!voiceChannel) {

            return interaction.reply({

              content:
                "❌ Join a voice channel first!",

              flags:
                MessageFlags.Ephemeral,

            });

          }


          let connection =
            getVoiceConnection(
              guildId
            );


          if (!connection) {

            connection =
              joinVoiceChannel({

                channelId:
                  voiceChannel.id,

                guildId,

                adapterCreator:
                  interaction.guild.voiceAdapterCreator,

                selfDeaf:
                  true,

              });


            await entersState(

              connection,

              VoiceConnectionStatus.Ready,

              30000

            );

          }


          return interaction.reply(
            `🎤 Connected to **${voiceChannel.name}**`
          );

        }


        /*
          DISCONNECT
        */

        if (
          command === "disconnect"
        ) {

          const connection =
            getVoiceConnection(
              guildId
            );


          if (connection) {

            connection.destroy();

          }


          const data =
            players.get(
              guildId
            );


          if (
            data?.updateInterval
          ) {

            clearInterval(
              data.updateInterval
            );

          }


          players.delete(
            guildId
          );


          return interaction.reply(
            "👋 Disconnected from the voice channel."
          );

        }


        const data =
          players.get(
            guildId
          );


        if (
          !data ||
          !data.current
        ) {

          return interaction.reply({

            content:
              "❌ No music is currently playing.",

            flags:
              MessageFlags.Ephemeral,

          });

        }


        /*
          SKIP
        */

        if (
          command === "skip"
        ) {

          data.player.stop();

          return interaction.reply(
            "⏩ Skipped the current song."
          );

        }


        /*
          PAUSE
        */

        if (
          command === "pause"
        ) {

          data.player.pause();

          await updateMusicMessage(
            data
          );


          return interaction.reply(
            "⏸️ Music paused."
          );

        }


        /*
          RESUME
        */

        if (
          command === "resume"
        ) {

          data.player.unpause();

          await updateMusicMessage(
            data
          );


          return interaction.reply(
            "▶️ Music resumed."
          );

        }


        /*
          VOLUME
        */

        if (
          command === "volume"
        ) {

          const amount =
            interaction.options.getInteger(
              "amount"
            );


          data.volume =
            amount / 100;


          if (
            data.resource?.volume
          ) {

            data.resource.volume.setVolume(
              data.volume
            );

          }


          await updateMusicMessage(
            data
          );


          return interaction.reply(
            `🔊 Volume set to **${amount}%**`
          );

        }


        /*
          LOOP
        */

        if (
          command === "loop"
        ) {

          data.loop =
            !data.loop;


          await updateMusicMessage(
            data
          );


          return interaction.reply(

            data.loop
              ? "🔁 Loop enabled."
              : "❌ Loop disabled."

          );

        }

      }


      /* =========================
         BUTTONS
      ========================= */

      if (
        interaction.isButton()
      ) {

        if (
          !interaction.guild
        ) return;


        const data =
          players.get(
            interaction.guild.id
          );


        if (
          !data ||
          !data.current
        ) {

          return interaction.reply({

            content:
              "❌ No music is currently playing.",

            flags:
              MessageFlags.Ephemeral,

          });

        }


        /*
          SKIP BUTTON
        */

        if (
          interaction.customId ===
          "skip"
        ) {

          data.player.stop();


          return interaction.reply({

            content:
              "⏩ Skipped.",

            flags:
              MessageFlags.Ephemeral,

          });

        }


        /*
          PAUSE / RESUME
        */

        if (
          interaction.customId ===
          "pause_resume"
        ) {

          if (

            data.player.state.status ===
            AudioPlayerStatus.Paused

          ) {

            data.player.unpause();

          } else {

            data.player.pause();

          }


          await updateMusicMessage(
            data
          );


          return interaction.reply({

            content:
              "⏯️ Playback updated.",

            flags:
              MessageFlags.Ephemeral,

          });

        }


        /*
          LOOP
        */

        if (
          interaction.customId ===
          "loop"
        ) {

          data.loop =
            !data.loop;


          await updateMusicMessage(
            data
          );


          return interaction.reply({

            content:

              data.loop
                ? "🔁 Loop enabled."
                : "❌ Loop disabled.",

            flags:
              MessageFlags.Ephemeral,

          });

        }


        /*
          VOLUME MODAL
        */

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

              .setRequired(
                true
              )

              .setPlaceholder(
                "50"
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


      /* =========================
         VOLUME MODAL
      ========================= */

      if (
        interaction.isModalSubmit()
      ) {

        if (

          interaction.customId ===
          "volume_modal"

        ) {

          const data =
            players.get(
              interaction.guild.id
            );


          if (!data) {

            return interaction.reply({

              content:
                "❌ No music is playing.",

              flags:
                MessageFlags.Ephemeral,

            });

          }


          const value =
            parseInt(

              interaction.fields.getTextInputValue(
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
                "❌ Enter a number between 1 and 100.",

              flags:
                MessageFlags.Ephemeral,

            });

          }


          data.volume =
            value / 100;


          if (
            data.resource?.volume
          ) {

            data.resource.volume.setVolume(
              data.volume
            );

          }


          await updateMusicMessage(
            data
          );


          return interaction.reply({

            content:
              `🔊 Volume set to **${value}%**`,

            flags:
              MessageFlags.Ephemeral,

          });

        }

      }

    } catch (error) {

      console.error(
        "INTERACTION ERROR:",
        error
      );


      if (
        interaction.isRepliable()
      ) {

        try {

          if (

            interaction.deferred ||
            interaction.replied

          ) {

            await interaction.editReply(
              "❌ An error occurred."
            );

          } else {

            await interaction.reply({

              content:
                "❌ An error occurred.",

              flags:
                MessageFlags.Ephemeral,

            });

          }

        } catch {}

      }

    }

  }

);


/* =========================
   LOGIN
========================= */

client.login(
  TOKEN
);
