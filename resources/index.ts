import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";
import * as awsx from "@pulumi/awsx";
//import * as cloud from "@pulumi/cloud-aws"; // Automation API 
import fetch from "node-fetch";
import * as express from "express";

import {IntegrationResponseT, CallbackT, RoutableResource} from "./types";

import {GKEStrategy} from "./gke"

export type StrategySelectorT = "LAMBDA" | "EC2" | "K8S";

class AWSLambdaStrategy<E> extends pulumi.ComponentResource implements RoutableResource {
    route: awsx.apigateway.Route;
    private lambda: aws.lambda.CallbackFunction<E, any>;

    constructor(name: string, args: {callback: CallbackT<E>, route: awsx.apigateway.Route /* TODO make partial */}, opts?: {}) {
        super("xbow:index:AWSLambdaStrategy", name, args, opts)
        
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
    route: pulumi.Output<awsx.apigateway.Route>;
    url: pulumi.OutputInstance<string>;
    constructor(name: string, args: {callback: CallbackT<E>, route: awsx.apigateway.Route /* TODO make partial */}, opts?: {}) {
        super("xbow:index:EC2Strategy", name, args, opts)

        const cloud = require("@pulumi/cloud-aws");

        const server = new cloud.HttpServer("myexpress", () => {
            const app = express();
            app.get("/", async (req: any, res: any) => {
                res.json({...await args.callback(req), host: "ec2"});
            });

            return app;
        });
        
        const url = server.url;

        this.route = pulumi.output(new Promise(async (resolve: (value: awsx.apigateway.Route) => void) => {
            url.apply(async (url: string) => {
                var statusCode: number | undefined;
                while (statusCode !== 200) {
                    try {
                        console.log(`waiting on server up [url=${url}]`)
                        statusCode = (await fetch(url)).status
                        console.log("success")
                    } catch(e) {
                        console.log("sleeping")
                        await new Promise(r => setTimeout(r, 5000));
                    }
                }
                resolve({
                    path: args.route.path,
                    target: {
                        uri: url,
                        type: "http_proxy",
                    }
                })
            })
        }));
        this.url = server.url
    }
}

class XAPIGateway extends pulumi.ComponentResource {
    url: pulumi.Output<string>;

    constructor(name:string, args: {
        route: pulumi.Input<awsx.apigateway.Route>,
    }, opts?: {}) {
        super("xbow:index:XAPIGateway", name, {}, opts)
        
        const route = pulumi.output(args.route);
        
        const apig = route.apply((route) => {
            let apig = new awsx.apigateway.API("myapi", {
                routes: [
                    route,
                ],
            }, {
                parent: this,
            })
            this.registerOutputs({
                url: apig.url,
            })
            return apig
        })
        this.url = apig.url
    }
}


class StrategicFaaS<E> extends pulumi.ComponentResource {
    private lambdaStrategy?: AWSLambdaStrategy<E>
    private ec2Strategy?: EC2Strategy<E>
    private k8sStrategy?: GKEStrategy<E>
    route?: awsx.apigateway.Route

    constructor(name: string, args: {
        callback: (e: E) => Promise<any>,
        path: string,
        method: awsx.apigateway.Method,
        strategy: StrategySelectorT,
    }, opts?: {}) {
        super("xbow:index:StrategicFaaS", name, {}, opts)

        const apigFromRoute = (route: awsx.apigateway.Route) => {
            return new XAPIGateway("routes", {
                route: route,
            }, {parent: this})
        }
        //console.log(`function deployed to: ${url}${this.route?.path.substring(1) || ""}`);
        let apig: awsx.apigateway.API | XAPIGateway;
        if (args.strategy === "LAMBDA") {
            this.lambdaStrategy = new AWSLambdaStrategy(name, {
                callback: args.callback,
                route: {
                    path: args.path,
                    method: args.method,
                    eventHandler: () => {},
                }
            }, {parent: this})
            const route = this.lambdaStrategy.route;
            apig = apigFromRoute(route)
        }
        else if (args.strategy === "EC2") {
            this.ec2Strategy = new EC2Strategy(name, {
                callback: args.callback,
                route: {
                    path: args.path,
                    method: args.method,
                    eventHandler: () => {},
                }
            }, {
                parent: this,
            })
            const route = this.ec2Strategy.route;
            apig = apigFromRoute(route as unknown as awsx.apigateway.Route) // dirty
        }
        else if (args.strategy === "K8S") {
            this.k8sStrategy = new GKEStrategy(name, {
                callback: args.callback,
                route: {
                    path: args.path,
                    method: args.method,
                    eventHandler: () => {},
                }
            }, {
                parent: this,
            })
            const route = this.k8sStrategy.route
            apig = apigFromRoute(route)
        }
        else {
            throw Error(`invalid [args.strategy=${args.strategy}]`);
        }
        apig.url.apply((base) => console.log(`${base}${args.path.substring(1)}`))
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