import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";
import * as awsx from "@pulumi/awsx";
//import * as cloud from "@pulumi/cloud-aws"; // Automation API 
import * as express from "express";

import {IntegrationResponseT, CallbackT, RoutableResource} from "./types";

import {GKEStrategy} from "./gke"

export type StrategySelectorT = "LAMBDA" | "EC2" | "K8S";

class AWSLambdaStrategy<E> extends pulumi.ComponentResource implements RoutableResource {
    route: awsx.apigateway.Route;
    private lambda: aws.lambda.CallbackFunction<E, any>;

    constructor(name: string, args: {callback: CallbackT<E>, route: awsx.apigateway.Route /* TODO make partial */}, opts?: {}) {
        super('xbow:index:AWSLambdaStrategy', name, args, opts)
        
        const integrationCallback = async (event: E) => {
            const response: IntegrationResponseT = {
                statusCode: 200,
                headers: {},
                body: JSON.stringify({...await args.callback(event), host: "lambda"})
            };
            return response;
        }
        this.lambda = new aws.lambda.CallbackFunction(`${name}-xbow-lambda`, {
            callback: integrationCallback,
        }, {parent: this})
        this.route = {...args.route, eventHandler: this.lambda}
    }
}

class EC2Strategy<E> extends pulumi.ComponentResource implements RoutableResource {
    route: awsx.apigateway.Route
    constructor(name: string, args: {callback: CallbackT<E>, route: awsx.apigateway.Route /* TODO make partial */}, opts?: {}) {
        super('xbow:index:EC2Strategy', name, args, opts)

        const cloud = require("@pulumi/cloud-aws");

        const server = new cloud.HttpServer("myexpress", () => {
            const app = express();
            app.get("/", async (req: any, res: any) => {
                res.json({...await args.callback(req), host: "ec2"});
            });

            return app;
        });

        const url = server.url;
        this.route = {
            path: args.route.path,
            target: {
                uri: url,
                type: "http_proxy",
            }
        }
    }
}

class StrategicFaaS<E> extends pulumi.ComponentResource {
    private lambdaStrategy?: AWSLambdaStrategy<E>
    private ec2Strategy?: EC2Strategy<E>
    private k8sStrategy?: GKEStrategy<E>
    route: awsx.apigateway.Route | null = null;

    constructor(name: string, args: {
        callback: (e: E) => Promise<any>,
        path: string,
        method: awsx.apigateway.Method,
        strategy: StrategySelectorT,
    }, opts?: {}) {
        super("xbow:index:StrategicFaaS:", name, {}, opts)

        if (args.strategy === "LAMBDA") {
            this.lambdaStrategy = new AWSLambdaStrategy(name, {
                callback: args.callback,
                route: {
                    path: args.path,
                    method: args.method,
                    eventHandler: () => {},
                }
            })
            this.route = this.lambdaStrategy.route
        }
        else if (args.strategy === "EC2") {
            this.ec2Strategy = new EC2Strategy(name, {
                callback: args.callback,
                route: {
                    path: args.path,
                    method: args.method,
                    eventHandler: () => {},
                }
            })
            this.route = this.ec2Strategy.route
        }
        else if (args.strategy === "K8S") {
            this.k8sStrategy = new GKEStrategy(name, {
                callback: args.callback,
                route: {
                    path: args.path,
                    method: args.method,
                    eventHandler: () => {},
                }
            })
            this.route = this.k8sStrategy.route
        }
        else {
            throw Error(`invalid [args.strategy=${args.strategy}]`);
        }
    
    const routes: awsx.apigateway.Route[] = [];

    if (this.route !== null) {
        routes.push(this.route);
    }
    const apig = new awsx.apigateway.API("routes", {
        routes,
    })
    apig.url.apply((url) => {
        console.log(`function deployed to: ${url}${this.route?.path.substring(1) || ''}`);
    })
    }
}

export const pulumiProgram = async function(strategy: StrategySelectorT) {

    const faas = new StrategicFaaS("myfaas", {
        strategy: strategy,
        callback: async (event: any) => {
            console.log("Hello World");
            return {"message": "Hello World"}
        },
        path: "/hello",
        method: "GET"
    })

}