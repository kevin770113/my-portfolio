// ==========================================
// 全域變數與狀態管理 (Global State)
// ==========================================

export const state = {
    isPrivacyMode: false, 
    currentRate: 32.5, 
    prevRate: 32.5, 
    latestDataTime: 0, 
    charts: {}, 
    currentMarketView: 'ALL', 
    realPortfolio: { tw: [], us: [] }, 
    sandboxScenarios: [], 
    activeScenarioId: 'real', 
    stockMapCache: {}, 
    globalCombinedList: [], 
    compareData: { realGlobal: null, realTW: null, realUS: null, sandboxList: [] },
    currentMCDim: 'P50', 
    currentPromptPrice: 0,
    isReportRendered: false, 
    pendingAIWeights: null,
    
    // 活體宇宙節點資料 (保留原始宣告)
    nodeStatsMap: {}, 
    fullGalaxyNodes: [], 
    fullGalaxyLinks: [], 
    rawLinkData: [], 

    // 全域歷史資料快取
    historicalDataCache: {},

    // PBI 恐慌抄底雷達專屬狀態
    pbiResults: [],
    isPbiRunning: false,

    // CSV 匯入管線的全域暫存與對帳變數
    pendingImportFile: null,
    pendingImportMarket: '',
    pendingCSVChunk: '',
    pendingHeaders: [],
    pendingExpectedCount: 0,
    pendingSkippedCount: 0
};
