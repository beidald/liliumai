import { Tool } from './base';
import { SkillLoader } from '../skills';
import logger from '../../utils/logger';
// 中文功能描述：保存技能工具类
export class SaveSkillTool extends Tool {
  constructor(private skills: SkillLoader) {
    super();
  }

  // 中文功能描述：保存技能工具类
  get name() { return 'save_skill'; }
  get description() { 
    return '将已验证成功的解决方案保存为 AI 技能。' +
           '严禁保存未经运行测试或测试失败的代码。' +
           '如果方案未经验证，请先执行验证或搜索更好的方案。' +
           '保存成功后，必须明确告知用户。'; 
  }

  // 中文功能描述：保存技能参数
  get parameters() {
    return {
      type: 'object',
      properties: {
        skillName: {
          type: 'string',
          description: '技能的简短描述性名称（建议使用英文，如 playwright_fix）'
        },
        content: {
          type: 'string',
          description: '技能的 Markdown 内容'
        }
      },
      required: ['skillName', 'content']
    };
  }
  // 中文功能描述：执行保存技能工具类
  async execute(params: { skillName: string; content: string }): Promise<string> {
    try {
      const filePath = await this.skills.saveAiSkill(params.skillName, params.content);
      return `Skill successfully saved to ${filePath}. It will be automatically loaded in future conversations.`;
    } catch (err: any) {
      logger.error(`Error saving skill tool: ${err.message}`);
      return `Error saving skill: ${err.message}`;
    }
  }
}
