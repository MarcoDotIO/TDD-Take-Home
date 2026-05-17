import { Duration, RemovalPolicy, Stack, type StackProps } from "aws-cdk-lib";
import { AuthorizationType, CognitoUserPoolsAuthorizer, LambdaIntegration, RestApi } from "aws-cdk-lib/aws-apigateway";
import { AttributeType, BillingMode, Table } from "aws-cdk-lib/aws-dynamodb";
import { UserPool, UserPoolClient, UserPoolGroup } from "aws-cdk-lib/aws-cognito";
import { Effect, PolicyStatement } from "aws-cdk-lib/aws-iam";
import { Code, Function, Runtime } from "aws-cdk-lib/aws-lambda";
import { BlockPublicAccess, Bucket, BucketEncryption } from "aws-cdk-lib/aws-s3";
import { Construct } from "constructs";

export class ColaVerificationStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    const uploadBucket = new Bucket(this, "LabelUploadBucket", {
      blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
      encryption: BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      removalPolicy: RemovalPolicy.RETAIN
    });

    const submissionsTable = new Table(this, "SubmissionsTable", {
      partitionKey: { name: "pk", type: AttributeType.STRING },
      billingMode: BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.RETAIN
    });
    submissionsTable.addGlobalSecondaryIndex({
      indexName: "byApplicant",
      partitionKey: { name: "applicantId", type: AttributeType.STRING }
    });

    const auditTable = new Table(this, "AuditTable", {
      partitionKey: { name: "pk", type: AttributeType.STRING },
      sortKey: { name: "createdAt", type: AttributeType.STRING },
      billingMode: BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.RETAIN
    });

    const usersTable = new Table(this, "UsersTable", {
      partitionKey: { name: "email", type: AttributeType.STRING },
      billingMode: BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.RETAIN
    });

    const userPool = new UserPool(this, "UserPool", {
      selfSignUpEnabled: true,
      signInAliases: { email: true },
      mfa: undefined,
      passwordPolicy: {
        minLength: 14,
        requireDigits: true,
        requireLowercase: true,
        requireUppercase: true,
        requireSymbols: true
      }
    });

    new UserPoolGroup(this, "ApplicantGroup", {
      userPool,
      groupName: "Applicant"
    });

    new UserPoolGroup(this, "AdminGroup", {
      userPool,
      groupName: "Admin"
    });

    const userPoolClient = new UserPoolClient(this, "WebClient", {
      userPool,
      authFlows: {
        userPassword: true,
        userSrp: true
      }
    });

    const apiHandler = new Function(this, "ApiPlaceholder", {
      runtime: Runtime.NODEJS_20_X,
      timeout: Duration.seconds(15),
      code: Code.fromInline(`
        exports.handler = async () => ({
          statusCode: 501,
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ error: "Deploy services/api as Lambda or ECS service for production." })
        });
      `),
      handler: "index.handler",
      environment: {
        SUBMISSIONS_TABLE: submissionsTable.tableName,
        AUDIT_TABLE: auditTable.tableName,
        USERS_TABLE: usersTable.tableName,
        UPLOAD_BUCKET: uploadBucket.bucketName
      }
    });

    submissionsTable.grantReadWriteData(apiHandler);
    auditTable.grantReadWriteData(apiHandler);
    usersTable.grantReadWriteData(apiHandler);
    uploadBucket.grantReadWrite(apiHandler);
    apiHandler.addToRolePolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: [
          "ses:SendEmail",
          "textract:AnalyzeDocument",
          "textract:DetectDocumentText",
          "bedrock:InvokeModel",
          "aws-external-anthropic:CreateInference",
          "aws-external-anthropic:CountTokens",
          "aws-external-anthropic:GetModel",
          "aws-external-anthropic:ListModels",
          "aws-external-anthropic:GetWorkspace",
          "aws-external-anthropic:ListWorkspaces"
        ],
        resources: ["*"]
      })
    );

    const api = new RestApi(this, "Api", {
      restApiName: "cola-verification-api",
      defaultCorsPreflightOptions: {
        allowHeaders: ["authorization", "content-type"],
        allowMethods: ["GET", "POST", "OPTIONS"],
        allowOrigins: ["*"]
      }
    });
    const authorizer = new CognitoUserPoolsAuthorizer(this, "Authorizer", {
      cognitoUserPools: [userPool]
    });
    api.root.addProxy({
      defaultIntegration: new LambdaIntegration(apiHandler),
      defaultMethodOptions: {
        authorizationType: AuthorizationType.COGNITO,
        authorizer
      },
      anyMethod: true
    });

    this.exportValue(userPool.userPoolId, { name: "ColaUserPoolId" });
    this.exportValue(userPoolClient.userPoolClientId, { name: "ColaUserPoolClientId" });
    this.exportValue(api.url, { name: "ColaApiUrl" });
    this.exportValue(uploadBucket.bucketName, { name: "ColaUploadBucketName" });
  }
}
