#!/usr/bin/env bun
import { App } from "aws-cdk-lib";
import { ColaVerificationStack } from "../lib/cola-verification-stack";

const app = new App();

new ColaVerificationStack(app, "ColaVerificationStack", {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION ?? "us-gov-west-1"
  }
});
