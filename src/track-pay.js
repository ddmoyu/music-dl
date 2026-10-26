export function trackPay(pay = {}) {
    const hint = (flag, action) =>
        flag === 1 ? `${action}收费` : flag === 0 ? `${action}无收费标记` : `${action}收费信息未知`;
    return {
        badge:
            pay.pay_month === 1
                ? 'VIP'
                : pay.pay_play === 1
                  ? '付费'
                  : pay.pay_down === 1
                    ? '下载付费'
                    : '',
        playHint: hint(pay.pay_play, '播放'),
        downloadHint: hint(pay.pay_down, '下载'),
        tooltip: [
            hint(pay.pay_play, '播放'),
            hint(pay.pay_down, '下载'),
            ...(pay.pay_month === 1 ? ['会员相关歌曲，实际权限以播放或下载结果为准'] : []),
        ].join('；'),
    };
}
