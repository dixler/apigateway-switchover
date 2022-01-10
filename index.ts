import * as process from "process";
import {
    LocalWorkspace,
    InlineProgramArgs,
} from "@pulumi/pulumi/automation";
import {pulumiProgram} from "./resources";


async function getStack() {
    const args: InlineProgramArgs = {
        stackName: "demo",
        projectName: "faas",
        program: getStack.currentProgram,
    };
    const stack = await LocalWorkspace.createOrSelectStack(args);
    await stack.workspace.installPlugin("aws", "v4.0.0");
    await stack.setConfig("aws:region", { value: "us-west-2" });
    return stack;
}
getStack.currentProgram = async () => pulumiProgram("LAMBDA")

type CommandString = "exit" | "lambda" | "ec2" | "k8s"

async function commandHandler(cmd: CommandString) {
    if (cmd === "exit") {
        const stack = await getStack();
        console.log("destroying stack...")
        await stack.destroy();
        console.log("done")
        process.exit()
    }
    else if (cmd === "lambda") {
        console.log("strategy: lambda")
        getStack.currentProgram = async () => pulumiProgram("LAMBDA")
    }
    else if (cmd === "ec2") {
        console.log("strategy: ec2")
        getStack.currentProgram = async () => pulumiProgram("EC2")
    }
    else if (cmd === "k8s") {
        console.log("[skipping unimplemented]")
        return
        console.log("strategy: k8s")
        getStack.currentProgram = async () => pulumiProgram("K8S")
    }
    else {
        console.log(`invalid command: ${cmd} skipping deployment.`)
        return;
    }
    const stack = await getStack();
    console.log("deploying stack...")
    await stack.up({ onOutput: console.info })
    console.log("done")
}

async function main() {
    let input = "";
    console.log("type 'exit' to exit the program:")
    process.stdin.on("data", async data => {
        process.stdin.pause();
        input = data.toString().trim();
        await commandHandler(input as CommandString);
        process.stdin.resume()
    });
}

main();