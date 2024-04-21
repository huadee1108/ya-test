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
  logs: logItem[] = [];
  constructor(
    bql: string,
    abiOrIdl: Record<string, any[] | Record<string, any>>,
    provider: any,
    account: string,
    setActionNetwork: any,
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
    this.solanaRpc = solanaRpc || "";
    this.uuid = getUuid();
    this.executeList = transferObjToList(this.context);
  }
  async run(step = 0, continuousExecution = true) {
    try {
      if (step >= this.executeList.length) {
        this.logs.push({
          type: "end",
          timeStamp: Date.now(),
          runId: this.uuid,
          code: this.executeList[step - 1],
          message: "Workflow stop running.",
        });
        return;
      }
      console.log(step, this.isPause);
      this.currentStep = step;
      if (this.isPause) return;
      if (this.isStop) {
        this.isStop = false;
        return;
      }

      const notStart =
        this.logs.find((item) => item.type === "start") === undefined;
      if (notStart) {
        this.logs.push({
          type: "start",
          timeStamp: Date.now(),
          runId: this.uuid,
          code: this.executeList[step],
          message: "Workflow start running.",
        });
      }

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
        await delay(500);
      }

      // interact contract
      if (key === "action") {
        console.log("xx");
        const pathValue = getValueByPath(this.context, path);
        const action = pathValue && pathValue[key];
        if (action?.network === "solana") {
          await interactContractSolana(
            action,
            this.abiOrIdl,
            this.provider,
            this.solanaRpc,
            this.logs,
            this.uuid
          );
        } else {
          await interactContractEvm(
            action,
            this.context,
            this.abiOrIdl,
            this.provider,
            this.account,
            this.logs,
            this.uuid
          );
        }
      }

      if (continuousExecution) {
        const nextStep = step + 1;
        await this.run(nextStep);
      }
    } catch (error: any) {
      const notError =
        this.logs.find((item) => item.type === "error") === undefined;
      notError &&
        this.logs.push({
          type: "error",
          timeStamp: Date.now(),
          runId: this.uuid,
          code: this.executeList[this.currentStep],
          message: error?.data?.message || error?.message || error,
        });
      const notEnd =
        this.logs.find((item) => item.type === "end") === undefined;
      notEnd &&
        this.logs.push({
          type: "end",
          timeStamp: Date.now(),
          runId: this.uuid,
          code: this.executeList[this.currentStep],
          message: "Workflow stop running.",
        });
      // throw the bottom-level message
      throw new Error(error?.data?.message || error?.message || error);
    }
  }
  pause() {
    this.isPause = true;
  }
  resume() {
    this.isPause = false;
    this.run(this.currentStep + 1);
  }
  stop() {
    this.isStop = true;
  }
}
