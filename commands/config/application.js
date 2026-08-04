const {
  EmbedBuilder,
  PermissionFlagsBits,
  SlashCommandBuilder
} = require('discord.js');

const {
  MAX_APPLICATION_QUESTIONS,
  addQuestion,
  createForm,
  deleteForm,
  getFormByName,
  getQuestions,
  listForms,
  removeQuestion,
  updateForm
} = require('../../utils/applications');

const {
  get,
  run
} = require('../../database');

const {
  canManageApplications
} = require('../../utils/applicationAccess');

function formatQuestions(
  questions
) {
  if (!questions.length) {
    return 'No questions yet.';
  }

  return questions
    .map(question =>
      `${question.position}. ${question.question}${question.required ? '' : ' (optional)'}`
    )
    .join('\n')
    .slice(0, 4000);
}

function applicationEmbed(
  form
) {
  const questions =
    getQuestions(form.id);

  return new EmbedBuilder()
    .setColor(
      form.enabled
        ? 0x57F287
        : 0xED4245
    )
    .setTitle(form.name)
    .setDescription(
      form.description ||
      'No description set.'
    )
    .addFields(
      {
        name: 'Status',
        value:
          form.enabled
            ? 'Enabled'
            : 'Disabled',
        inline: true
      },
      {
        name: 'Questions',
        value:
          `${questions.length}/${MAX_APPLICATION_QUESTIONS}`,
        inline: true
      },
      {
        name: 'Reviewer Role',
        value:
          form.reviewerRoleId
            ? `<@&${form.reviewerRoleId}>`
            : 'Ticket category staff role',
        inline: true
      },
      {
        name: 'Question List',
        value: formatQuestions(questions)
      }
    )
    .setTimestamp();
}

function requireForm(
  interaction,
  name
) {
  const form =
    getFormByName(
      interaction.guild.id,
      name
    );

  if (!form) {
    throw new Error(
      'Application not found.'
    );
  }

  return form;
}

module.exports = {
  cooldown: 5000,
  ephemeral: true,

  data:
    new SlashCommandBuilder()
      .setName('application')
      .setDescription('Create and edit ticket applications')
      .addSubcommand(subcommand =>
        subcommand
          .setName('create')
          .setDescription('Create an application')
          .addStringOption(option =>
            option
              .setName('name')
              .setDescription('Application name')
              .setRequired(true)
              .setMinLength(2)
              .setMaxLength(80)
          )
          .addRoleOption(option =>
            option
              .setName('reviewer_role')
              .setDescription('Role allowed to review this application')
              .setRequired(true)
          )
          .addStringOption(option =>
            option
              .setName('description')
              .setDescription('Short description')
              .setRequired(false)
              .setMaxLength(500)
          )
      )
      .addSubcommand(subcommand =>
        subcommand
          .setName('setcreatorrole')
          .setDescription('Set a role allowed to manage applications')
          .addRoleOption(option =>
            option
              .setName('role')
              .setDescription('Role allowed to create and edit applications')
              .setRequired(true)
          )
      )
      .addSubcommand(subcommand =>
        subcommand
          .setName('clearcreatorrole')
          .setDescription('Require Administrator to manage applications')
      )
      .addSubcommand(subcommand =>
        subcommand
          .setName('list')
          .setDescription('List applications')
      )
      .addSubcommand(subcommand =>
        subcommand
          .setName('delete')
          .setDescription('Delete an application')
          .addStringOption(option =>
            option
              .setName('name')
              .setDescription('Application name')
              .setRequired(true)
          )
      )
      .addSubcommandGroup(group =>
        group
          .setName('edit')
          .setDescription('Edit an application')
          .addSubcommand(subcommand =>
            subcommand
              .setName('add')
              .setDescription('Add a question')
              .addStringOption(option =>
                option
                  .setName('name')
                  .setDescription('Application name')
                  .setRequired(true)
              )
              .addStringOption(option =>
                option
                  .setName('question')
                  .setDescription('Question to ask')
                  .setRequired(true)
                  .setMinLength(3)
                  .setMaxLength(250)
              )
              .addBooleanOption(option =>
                option
                  .setName('required')
                  .setDescription('Require an answer')
                  .setRequired(false)
              )
          )
          .addSubcommand(subcommand =>
            subcommand
              .setName('remove')
              .setDescription('Remove a question')
              .addStringOption(option =>
                option
                  .setName('name')
                  .setDescription('Application name')
                  .setRequired(true)
              )
              .addIntegerOption(option =>
                option
                  .setName('number')
                  .setDescription('Question number')
                  .setMinValue(1)
                  .setMaxValue(MAX_APPLICATION_QUESTIONS)
                  .setRequired(true)
              )
          )
          .addSubcommand(subcommand =>
            subcommand
              .setName('rename')
              .setDescription('Rename an application')
              .addStringOption(option =>
                option
                  .setName('name')
                  .setDescription('Current application name')
                  .setRequired(true)
              )
              .addStringOption(option =>
                option
                  .setName('new_name')
                  .setDescription('New application name')
                  .setRequired(true)
                  .setMinLength(2)
                  .setMaxLength(80)
              )
          )
          .addSubcommand(subcommand =>
            subcommand
              .setName('description')
              .setDescription('Update an application description')
              .addStringOption(option =>
                option
                  .setName('name')
                  .setDescription('Application name')
                  .setRequired(true)
              )
              .addStringOption(option =>
                option
                  .setName('description')
                  .setDescription('New description')
                  .setRequired(true)
                  .setMaxLength(500)
              )
          )
          .addSubcommand(subcommand =>
            subcommand
              .setName('reviewerrole')
              .setDescription('Change the role that can review this application')
              .addStringOption(option =>
                option
                  .setName('name')
                  .setDescription('Application name')
                  .setRequired(true)
              )
              .addRoleOption(option =>
                option
                  .setName('role')
                  .setDescription('Role allowed to review this application')
                  .setRequired(true)
              )
          )
          .addSubcommand(subcommand =>
            subcommand
              .setName('enable')
              .setDescription('Enable an application')
              .addStringOption(option =>
                option
                  .setName('name')
                  .setDescription('Application name')
                  .setRequired(true)
              )
          )
          .addSubcommand(subcommand =>
            subcommand
              .setName('disable')
              .setDescription('Disable an application')
              .addStringOption(option =>
                option
                  .setName('name')
                  .setDescription('Application name')
                  .setRequired(true)
              )
          )
      ),

  async execute(interaction) {
    try {
      const group =
        interaction.options.getSubcommandGroup(false);

      const subcommand =
        interaction.options.getSubcommand();

      const isAdministrator =
        interaction.memberPermissions.has(
          PermissionFlagsBits.Administrator
        );

      const access =
        get(
          `SELECT applicationCreatorRoleId
           FROM guild_settings
           WHERE guildId = ?`,
          [interaction.guild.id]
        );

      const canManage =
        canManageApplications(
          interaction.member,
          access?.applicationCreatorRoleId
        );

      if (
        !canManage
      ) {
        return interaction.editReply({
          content:
            'You need Administrator permission or the configured application management role.'
        });
      }

      if (!group && subcommand === 'setcreatorrole') {
        if (!isAdministrator) {
          return interaction.editReply({
            content: 'You need Administrator permission.'
          });
        }

        const role =
          interaction.options.getRole('role', true);

        if (role.managed || role.id === interaction.guild.roles.everyone.id) {
          return interaction.editReply({
            content: 'Choose a normal server role.'
          });
        }

        run(
          `INSERT INTO guild_settings (
             guildId,
             applicationCreatorRoleId
           )
           VALUES (?, ?)
           ON CONFLICT(guildId)
           DO UPDATE SET applicationCreatorRoleId = excluded.applicationCreatorRoleId`,
          [
            interaction.guild.id,
            role.id
          ]
        );

        return interaction.editReply({
          content: `${role} can now create and manage applications.`
        });
      }

      if (!group && subcommand === 'clearcreatorrole') {
        if (!isAdministrator) {
          return interaction.editReply({
            content: 'You need Administrator permission.'
          });
        }

        run(
          `INSERT INTO guild_settings (
             guildId,
             applicationCreatorRoleId
           )
           VALUES (?, NULL)
           ON CONFLICT(guildId)
           DO UPDATE SET applicationCreatorRoleId = NULL`,
          [interaction.guild.id]
        );

        return interaction.editReply({
          content: 'Only administrators can now manage applications.'
        });
      }

      if (!group && subcommand === 'create') {
        const name =
          interaction.options.getString('name', true);

        const description =
          interaction.options.getString('description') ||
          null;

        const reviewerRole =
          interaction.options.getRole('reviewer_role', true);

        if (
          reviewerRole.managed ||
          reviewerRole.id === interaction.guild.roles.everyone.id
        ) {
          return interaction.editReply({
            content:
              'Choose a normal server role for application reviewers.'
          });
        }

        const result =
          createForm({
            guildId: interaction.guild.id,
            name,
            description,
            reviewerRoleId: reviewerRole.id,
            createdBy: interaction.user.id
          });

        const form =
          getFormByName(
            interaction.guild.id,
            name
          );

        return interaction.editReply({
          embeds: [
            applicationEmbed(form)
              .setFooter({
                text:
                  `Created application #${result.lastInsertRowid}`
              })
          ]
        });
      }

      if (!group && subcommand === 'list') {
        const forms =
          listForms(interaction.guild.id);

        return interaction.editReply({
          embeds: [
            new EmbedBuilder()
              .setColor(0x5865F2)
              .setTitle('Applications')
              .setDescription(
                forms.length
                  ? forms
                      .map(form => {
                        const questions =
                          getQuestions(form.id);

                        return `${form.enabled ? 'Enabled' : 'Disabled'} - **${form.name}** (${questions.length}/${MAX_APPLICATION_QUESTIONS} questions) - ${form.reviewerRoleId ? `<@&${form.reviewerRoleId}>` : 'ticket staff role'}`;
                      })
                      .join('\n')
                  : 'No applications created yet.'
              )
              .setTimestamp()
          ]
        });
      }

      if (!group && subcommand === 'delete') {
        const form =
          requireForm(
            interaction,
            interaction.options.getString('name', true)
          );

        deleteForm(form.id);

        return interaction.editReply({
          content:
            `Deleted application **${form.name}**.`
        });
      }

      const form =
        requireForm(
          interaction,
          interaction.options.getString('name', true)
        );

      if (subcommand === 'add') {
        addQuestion({
          guildId: interaction.guild.id,
          formId: form.id,
          question:
            interaction.options.getString('question', true),
          required:
            interaction.options.getBoolean('required') ?? true
        });
      }

      if (subcommand === 'remove') {
        const removed =
          removeQuestion(
            form.id,
            interaction.options.getInteger('number', true)
          );

        if (!removed) {
          return interaction.editReply({
            content:
              'Question not found.'
          });
        }
      }

      if (subcommand === 'rename') {
        updateForm(
          form.id,
          {
            name:
              interaction.options.getString('new_name', true)
          }
        );
      }

      if (subcommand === 'description') {
        updateForm(
          form.id,
          {
            description:
              interaction.options.getString('description', true)
          }
        );
      }

      if (subcommand === 'reviewerrole') {
        const reviewerRole =
          interaction.options.getRole('role', true);

        if (
          reviewerRole.managed ||
          reviewerRole.id === interaction.guild.roles.everyone.id
        ) {
          return interaction.editReply({
            content:
              'Choose a normal server role for application reviewers.'
          });
        }

        updateForm(
          form.id,
          {
            reviewerRoleId: reviewerRole.id
          }
        );
      }

      if (subcommand === 'enable') {
        updateForm(
          form.id,
          {
            enabled: true
          }
        );
      }

      if (subcommand === 'disable') {
        updateForm(
          form.id,
          {
            enabled: false
          }
        );
      }

      const refreshed =
        getFormByName(
          interaction.guild.id,
          subcommand === 'rename'
            ? interaction.options.getString('new_name', true)
            : form.name
        );

      return interaction.editReply({
        embeds: [
          applicationEmbed(refreshed)
        ]
      });

    } catch (err) {
      if (
        String(err.message || '')
          .toLowerCase()
          .includes('unique')
      ) {
        return interaction.editReply({
          content:
            'An application with that name already exists.'
        });
      }

      return interaction.editReply({
        content:
          err.message || 'Failed to update application.'
      });
    }
  }
};
