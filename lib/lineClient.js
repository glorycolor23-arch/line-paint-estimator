
import { Client } from '@line/bot-sdk';

export const client = new Client({
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
  channelSecret: process.env.LINE_CHANNEL_SECRET
});

export function liffButtonMessage(url){
  return {
    type:'template',
    altText:'詳細見積もりを見る',
    template:{
      type:'buttons',
      text:'さらに詳しい見積もりを確認しますか？',
      actions:[{ type:'uri', label:'詳細見積もりを開く', uri:url }]
    }
  };
}
