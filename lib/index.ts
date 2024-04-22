import yaml from "js-yaml";
import {
  replaceVariables,
  transferObjToList,
  functionParser,
  getUuid,
  getValueByPath,
  delay,
} from "./utils/common/index.js";
import { ListItem } from "./utils/common/transferObjToList.js";
import {
  interactContractEvm,
  interactContractSolana,
} from "./utils/interactContract/index.js";
import { publicVariable } from "./config/index.js";

export interface logItem {
  type: "start" | "end" | "action" | "error";
  timeStamp: number;
  runId: string;
  code: any;
  message: string;
}

export class Executor {
  bql = "";
  context: Record<string, any> = {};
  executeList: ListItem[] = [];
  provider: any = null;
  account: string = "";
  abiOrIdl: Record<string, any[] | Record<string, any>> = {};
  solanaRpc: string = "";
  currentStep: number = 0;
  isPause: boolean = false;
  isStop: boolean = false;
  uuid: string = "";
  setActionNetwork: any;
  setLogs: any;
  constructor(
    bql: string,
    abiOrIdl: Record<string, any[] | Record<string, any>>,
    provider: any,
    account: string,
    setActionNetwork: any,
    setLogs?: any,
    solanaRpc?: string
  ) {
    this.bql = bql;
    const bqlObj = yaml.load(bql);
    const wrapObj = { ADDRESS: account, ...publicVariable, ...bqlObj };
    this.context = wrapObj;
    this.abiOrIdl = abiOrIdl;
    this.provider = provider;
    this.account = account;
    this.setActionNetwork = setActionNetwork;
    this.setLogs = setLogs;
    this.solanaRpc = solanaRpc || "";
    this.uuid = getUuid();
    this.executeList = transferObjToList(this.context);
  }
  async run(step = 0, continuousExecution = true) {
    try {
      if (step >= this.executeList.length) {
        // end log
        const endLog: logItem = {
          type: "end",
          timeStamp: Date.now(),
          runId: this.uuid,
          code: this.executeList[step - 1],
          message: "Workflow stop running.",
        };
        this.setLogs && this.setLogs((state: any) => [...state, endLog]);
        return;
      }
      console.log(step, this.isPause);
      this.currentStep = step;
      if (this.isPause) return;
      if (this.isStop) {
        this.isStop = false;
        return;
      }

      //start log
      const startLog: logItem = {
        type: "start",
        timeStamp: Date.now(),
        runId: this.uuid,
        code: this.executeList[step],
        message: "Workflow start running.",
      };
      this.setLogs &&
        this.setLogs((state: any) => {
          const notStart =
            state.find((item: any) => item.type === "start") === undefined;
          const returnLogs = [...state];
          if (notStart) returnLogs.push(startLog);
          return returnLogs;
        });

      const { key, value, path } = this.executeList[step];
      // replace variables
      if (typeof value === "string" && value.startsWith("$")) {
        replaceVariables(key, value, path, this.context);
      }

      // function parsing
      if (typeof key === "string" && key.startsWith("_")) {
        functionParser(key, path, this.context);
      }

      // return network
      if (key === "network") {
        this.setActionNetwork(value);
        await delay(100);
      }

      // interact contract
      if (key === "action") {
        const pathValue = getValueByPath(this.context, path);
        const action = pathValue && pathValue[key];
        if (action?.network === "solana") {
          await interactContractSolana(
            action,
            this.abiOrIdl,
            this.provider,
            this.solanaRpc,
            this.setLogs,
            this.uuid
          );
        } else {
          await interactContractEvm(
            action,
            this.context,
            this.abiOrIdl,
            this.provider,
            this.account,
            this.setLogs,
            this.uuid
          );
        }
      }

      if (continuousExecution) {
        const nextStep = step + 1;
        await this.run(nextStep);
      }
    } catch (error: any) {
      // error log
      const errorLog: logItem = {
        type: "error",
        timeStamp: Date.now(),
        runId: this.uuid,
        code: this.executeList[this.currentStep],
        message: error?.data?.message || error?.message || error,
      };
      this.setLogs &&
        this.setLogs((state: any) => {
          const notStart =
            state.find((item: any) => item.type === "error") === undefined;
          const returnLogs = [...state];
          if (notStart) returnLogs.push(errorLog);
          return returnLogs;
        });

      // end log
      const endLog: logItem = {
        type: "end",
        timeStamp: Date.now(),
        runId: this.uuid,
        code: this.executeList[this.currentStep],
        message: "Workflow stop running.",
      };
      this.setLogs &&
        this.setLogs((state: any) => {
          const notStart =
            state.find((item: any) => item.type === "error") === undefined;
          const returnLogs = [...state];
          if (notStart) returnLogs.push(endLog);
          return returnLogs;
        });
      // throw the bottom-level message
      throw new Error(error?.data?.message || error?.message || error);
    }
  }
  pause() {
    this.isPause = true;
  }
  async resume() {
    this.isPause = false;
    await this.run(this.currentStep);
  }
  stop() {
    this.isStop = true;
  }
}
