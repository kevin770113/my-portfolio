// utils/pbiModel.ts

export interface MarketData {
  date: string | Date;
  close: number;
  high: number;
  low: number;
  volume: number;
}

export interface CurrentState {
  availableCash: number;
  totalShares: number;
  lastBuyDate: string | Date | null;
  baseInvestUnit: number;
}

export interface PBIResult {
  action: 'Strong Buy' | 'Standard Buy' | 'Small Buy' | 'Wait';
  finalScore: number;
  targetAmount: number;
  actualInvestAmount: number;
  newLastBuyDate: string | Date | null;
}

/**
 * 通用型階梯式恐慌抄底模型核心運算
 */
export const calculatePBISignal = (
  marketData: MarketData[],
  currentState: CurrentState
): PBIResult => {
  const { availableCash, lastBuyDate, baseInvestUnit } = currentState;
  const dataLen = marketData.length;

  // 1. 基本資料防呆：至少需要 240 天資料來計算 240MA
  if (dataLen < 240) {
    return { action: 'Wait', finalScore: 0, targetAmount: 0, actualInvestAmount: 0, newLastBuyDate: lastBuyDate };
  }

  const todayData = marketData[dataLen - 1];
  const todayDateStr = new Date(todayData.date).toISOString().split('T')[0];

  // 2. 冷卻期檢查 (Cooldown Guard)
  if (lastBuyDate) {
    const lastDate = new Date(lastBuyDate);
    const today = new Date(todayData.date);
    // 簡單計算天數差 (實務上可優化為略過假日的交易日計算)
    const diffTime = Math.abs(today.getTime() - lastDate.getTime());
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    if (diffDays <= 5) {
      return { action: 'Wait', finalScore: 0, targetAmount: 0, actualInvestAmount: 0, newLastBuyDate: lastBuyDate };
    }
  }

  // === 因子一：日線 KDJ 計算 (9, 3, 3) ===
  // (此處簡化計算邏輯，需迭代過去數據產生精確的 K, D 值)
  // 實務上建議使用 technicalindicators 庫，此處示範邏輯結構
  const yesterdayK = 18; // 模擬數據：昨日K值
  const yesterdayD = 22; // 模擬數據：昨日D值
  const todayK = 21;     // 模擬數據：本日K值
  const todayD = 20;     // 模擬數據：本日D值
  
  let scoreKDJ = 0;
  const isKDJGoldenCross = (yesterdayK < 25) && (yesterdayK < yesterdayD) && (todayK > todayD);
  if (isKDJGoldenCross) {
    if (yesterdayK < 10) scoreKDJ = 40;
    else if (yesterdayK < 15) scoreKDJ = 30;
    else if (yesterdayK < 20) scoreKDJ = 20;
  }

  // === 因子二：日線 AMT 量能階梯 ===
  let vol20Sum = 0;
  for (let i = dataLen - 20; i < dataLen; i++) {
    vol20Sum += marketData[i].volume;
  }
  const vol20MA = vol20Sum / 20;
  const volRatio = todayData.volume / vol20MA;
  
  let scoreAMT = 0;
  if (volRatio >= 2.5) scoreAMT = 40;
  else if (volRatio >= 2.0) scoreAMT = 30;
  else if (volRatio >= 1.5) scoreAMT = 15;

  // === 因子三：MACD 動能收斂 ===
  // (需計算 EMA12, EMA26, DEA9, 取得 OSC)
  const oscT3 = -5; // 大前天
  const oscT2 = -4; // 前天
  const oscT1 = -3; // 昨日
  const oscT0 = -1; // 本日
  
  let scoreMACD = 0;
  const isMacdConverging = (oscT3 < oscT2) && (oscT2 < oscT1) && (oscT0 > oscT1) && (oscT0 < 0);
  if (isMacdConverging) scoreMACD = 30;

  // === 因子四：240MA 乖離率 ===
  let close240Sum = 0;
  for (let i = dataLen - 240; i < dataLen; i++) {
    close240Sum += marketData[i].close;
  }
  const ma240 = close240Sum / 240;
  const bias = (todayData.close - ma240) / ma240;
  
  let multiplierBIAS = 1.0;
  if (bias > 0.15) multiplierBIAS = 0.7;
  else if (bias < -0.10) multiplierBIAS = 1.5;
  else if (bias < 0.00) multiplierBIAS = 1.2;

  // === 最終分數與級距判定 ===
  const baseScore = scoreKDJ + scoreAMT + scoreMACD;
  const finalScore = baseScore * multiplierBIAS;

  let action: PBIResult['action'] = 'Wait';
  let targetAmount = 0;

  if (finalScore >= 90) {
    action = 'Strong Buy';
    targetAmount = baseInvestUnit * 1.5;
  } else if (finalScore >= 75) {
    action = 'Standard Buy';
    targetAmount = baseInvestUnit * 1.0;
  } else if (finalScore >= 60) {
    action = 'Small Buy';
    targetAmount = baseInvestUnit * 0.5;
  } else {
    action = 'Wait';
    targetAmount = 0;
  }

  // 資金水位檢查
  if (availableCash <= 0) {
    action = 'Wait';
    targetAmount = 0;
  }

  const actualInvestAmount = Math.min(targetAmount, availableCash);

  return {
    action,
    finalScore,
    targetAmount,
    actualInvestAmount,
    newLastBuyDate: actualInvestAmount > 0 ? todayDateStr : lastBuyDate,
  };
};
