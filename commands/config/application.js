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
  editQuestion,
  moveQuestion,
  updateForm
} = require('../../utils/applications');

const {
  get,
  run
} = require('../../database');

const {
  canManageApplications
} = require('../../utils/applicationAccess');

const {
  reviewApplication
} = require('../../utils/tickets/applicationReview');

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
  form, page = 1
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
        value: formatQuestions(questions.slice((page-1)*3,page*3))
      }
    )
    .setFooter({text:`Questions page ${page}/${Math.max(1,Math.ceil(questions.length/3))}; use /application view for another page.`})
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
          .addIntegerOption(option=>option.setName('page').setDescription('Page').setMinValue(1))
      )
      .addSubcommand(subcommand=>subcommand.setName('view').setDescription('View every question without truncation.')
        .addStringOption(option=>option.setName('name').setDescription('Application name').setRequired(true))
        .addIntegerOption(option=>option.setName('page').setDescription('Questions page').setMinValue(1)))
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
      .addSubcommand(subcommand =>
        subcommand
          .setName('accept')
          .setDescription('Accept and close the application in this ticket')
          .addStringOption(option =>
            option
              .setName('reason')
              .setDescription('Reason for accepting this application')
              .setRequired(true)
              .setMinLength(3)
              .setMaxLength(1000)
          )
      )
      .addSubcommand(subcommand =>
        subcommand
          .setName('deny')
          .setDescription('Deny and close the application in this ticket')
          .addStringOption(option =>
            option
              .setName('reason')
              .setDescription('Reason for denying this application')
              .setRequired(true)
              .setMinLength(3)
              .setMaxLength(1000)
          )
      )
      .addSubcommandGroup(group =>
        group
          .setName('edit')
          .setDescription('Edit an application')
          .addSubcommand(command=>command.setName('question').setDescription('Edit a question in place; existing drafts keep their snapshot.')
            .addStringOption(option=>option.setName('name').setDescription('Application name').setRequired(true))
            .addIntegerOption(option=>option.setName('number').setDescription('Question number').setRequired(true).setMinValue(1).setMaxValue(MAX_APPLICATION_QUESTIONS))
            .addStringOption(option=>option.setName('question').setDescription('New question text').setMaxLength(250).setMinLength(3))
            .addBooleanOption(option=>option.setName('required').setDescription('Require an answer'))
            .addStringOption(option=>option.setName('answer_type').setDescription('Answer validation').addChoices(...['TEXT','YES_NO','CHOICE','NUMBER'].map(value=>({name:value,value}))))
            .addStringOption(option=>option.setName('choices').setDescription('Choice options separated by |').setMaxLength(809)))
          .addSubcommand(command=>command.setName('move').setDescription('Reorder a question; existing drafts keep their snapshot.')
            .addStringOption(option=>option.setName('name').setDescription('Application name').setRequired(true))
            .addIntegerOption(option=>option.setName('from').setDescription('Current question number').setRequired(true).setMinValue(1).setMaxValue(MAX_APPLICATION_QUESTIONS))
            .addIntegerOption(option=>option.setName('to').setDescription('New question number').setRequired(true).setMinValue(1).setMaxValue(MAX_APPLICATION_QUESTIONS)))
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
              .addStringOption(option=>option.setName('answer_type').setDescription('How answers should be validated')
                .addChoices(...['TEXT','YES_NO','CHOICE','NUMBER'].map(value=>({name:value,value}))))
              .addStringOption(option=>option.setName('choices').setDescription('For CHOICE questions: separate 2-10 options with |').setMaxLength(809))
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

      if (!group && ['accept', 'deny'].includes(subcommand)) {
        const result = await reviewApplication({
          interaction,
          decision: subcommand === 'accept' ? 'ACCEPTED' : 'DENIED',
          reason: interaction.options.getString('reason', true)
        });

        return interaction.editReply({
          content:
            `Application ${result.decision.toLowerCase()} and archived.` +
            (result.applicantNotified
              ? ' The applicant was notified.'
              : ' I could not DM the applicant.')
        });
      }

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
                      .slice(((interaction.options.getInteger('page') || 1)-1)*15,(interaction.options.getInteger('page') || 1)*15).map(form => {
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

      if (subcommand === 'view') {
        const page=interaction.options.getInteger('page') || 1;
        if(page>Math.max(1,Math.ceil(getQuestions(form.id).length/3))) throw new Error('No questions on that page.');
        return interaction.editReply({embeds:[applicationEmbed(form,page)],allowedMentions:{parse:[]}});
      }

      if (subcommand === 'add') {
        addQuestion({
          guildId: interaction.guild.id,
          formId: form.id,
          question:
            interaction.options.getString('question', true),
          required:
            interaction.options.getBoolean('required') ?? true,
          answerType:interaction.options.getString('answer_type') || 'TEXT',
          choices:(interaction.options.getString('choices') || '').split('|')
        });
      }

      if(subcommand==='question') {
        const fields={};
        for(const [option,key]of [['question','question'],['answer_type','answerType']]) if(interaction.options.getString(option)!==null)fields[key]=interaction.options.getString(option);
        if(interaction.options.getBoolean('required')!==null)fields.required=interaction.options.getBoolean('required');
        if(interaction.options.getString('choices')!==null)fields.choices=interaction.options.getString('choices').split('|');
        editQuestion(form.id,interaction.options.getInteger('number',true),fields);
      }
      if(subcommand==='move') moveQuestion(form.id,interaction.options.getInteger('from',true),interaction.options.getInteger('to',true));

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
