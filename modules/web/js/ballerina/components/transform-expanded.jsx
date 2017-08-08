/**
 * Copyright (c) 2017, WSO2 Inc. (http://www.wso2.org) All Rights Reserved.
 *
 * WSO2 Inc. licenses this file to you under the Apache License,
 * Version 2.0 (the "License"); you may not use this file except
 * in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing,
 * software distributed under the License is distributed on an
 * "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
 * KIND, either express or implied. See the License for the
 * specific language governing permissions and limitations
 * under the License.
 */

import React from 'react';
import PropTypes from 'prop-types';
import _ from 'lodash';
import $ from 'jquery';
import alerts from 'alerts';
import log from 'log';
import TransformRender from '../../ballerina/components/transform-render';
import SuggestionsDropdown from './transform-endpoints-dropdown';
import BallerinaASTFactory from '../ast/ballerina-ast-factory';
import ASTNode from '../ast/node';
import DragDropManager from '../tool-palette/drag-drop-manager';
import Tree from './transform/tree';
import FunctionInv from './transform/function';
import './transform-expanded.css';

class TransformExpanded extends React.Component {
    constructor(props, context){
        super(props, context);
        this.state = {
            typedSource: '',
            typedTarget: '',
            selectedSource: '-1',
            selectedTarget: '-1',
        }
        this.predefinedStructs = [];
        this.sourceElements = {};
        this.targetElements = {};
        this.getSourcesAndTargets();

        this.onSourceSelect = this.onSourceSelect.bind(this);
        this.onTargetSelect = this.onTargetSelect.bind(this);
        this.onSourceAdd = this.onSourceAdd.bind(this);
        this.onTargetAdd = this.onTargetAdd.bind(this);
        this.onClose = this.onClose.bind(this);
        this.onTransformDropZoneActivate = this.onTransformDropZoneActivate.bind(this);
        this.onTransformDropZoneDeactivate = this.onTransformDropZoneDeactivate.bind(this);
        this.onSourceInputChange = this.onSourceInputChange.bind(this);
        this.onTargetInputChange = this.onTargetInputChange.bind(this);
        this.onSourceInputEnter = this.onSourceInputEnter.bind(this);
        this.onTargetInputEnter = this.onTargetInputEnter.bind(this);
        this.addSource = this.addSource.bind(this);
        this.addTarget = this.addTarget.bind(this);
        this.recordSourceElement = this.recordSourceElement.bind(this);
        this.recordTargetElement = this.recordTargetElement.bind(this);
    }

    getFunctionDefinition(functionInvocationExpression) {
        const funPackage = this.context.environment.getPackageByName(functionInvocationExpression.getFullPackageName());
        let funcDef = funPackage.getFunctionDefinitionByName(functionInvocationExpression.getFunctionName());
         _.forEach(funcDef.getParameters(), (param) => {
                param.innerType = _.find(this.predefinedStructs, { typeName: param.type });
         });
        return funcDef;
    }

    onConnectionCallback(connection) {
        const self = this;
        const sourceStruct = _.find(self.predefinedStructs, { name: connection.sourceStruct });
        const targetStruct = _.find(self.predefinedStructs, { name: connection.targetStruct });
        let sourceExpression;
        let targetExpression;

        if (sourceStruct !== undefined) {
            sourceExpression = self.getStructAccessNode(
                connection.sourceStruct, connection.sourceProperty,
                      ((sourceStruct.type === 'struct') || (sourceStruct.type.startsWith('json'))));
        }
        if (targetStruct !== undefined) {
            targetExpression = self.getStructAccessNode(
                connection.targetStruct, connection.targetProperty,
                      ((targetStruct.type === 'struct') || (targetStruct.type.startsWith('json'))));
        }

        debugger;

        if (!_.isUndefined(sourceStruct) && !connection.isSourceFunction &&
            !_.isUndefined(targetStruct) && !connection.isTargetFunction) {
            // Connection is from source struct to target struct.
            const assignmentStmt = BallerinaASTFactory.createAssignmentStatement();
            const varRefList = BallerinaASTFactory.createVariableReferenceList();
            varRefList.addChild(targetExpression);
            assignmentStmt.addChild(varRefList, 0);
            assignmentStmt.addChild(sourceExpression, 1);
            self.props.model.addChild(assignmentStmt);
            return assignmentStmt.id;
        }

        if (!_.isUndefined(sourceStruct) && connection.isTargetFunction) {
            // Connection source is a struct and target is not a struct.
            // Target could be a function node.
            const assignmentStmtSource = connection.targetReference;
            let funcNode;
            if (BallerinaASTFactory.isFunctionInvocationExpression(connection.targetReference)) {
                funcNode = connection.targetReference;
            } else {
                funcNode = connection.targetReference.getRightExpression();
            }
            let index = _.findIndex(self.getFunctionDefinition(funcNode).getParameters(),
                                    (param) => { return param.name == connection.targetStruct });
            let refType = BallerinaASTFactory.createReferenceTypeInitExpression();
            if (connection.targetProperty && BallerinaASTFactory.isReferenceTypeInitExpression(funcNode.children[index])) {
                refType = funcNode.children[index];
            }
            funcNode.removeChild(funcNode.children[index], true);
            //check function parameter is a struct and mapping is a complex mapping
            if (connection.targetProperty && _.find(self.predefinedStructs, (struct) =>
                        {return struct.typeName == self.getFunctionDefinition(funcNode).getParameters()[index].type})) {
                let keyValEx = BallerinaASTFactory.createKeyValueExpression();
                let nameVarRefExpression = BallerinaASTFactory.createSimpleVariableReferenceExpression();

                const propChain = connection.targetProperty.split('.').splice(1);

                nameVarRefExpression.setExpressionFromString(propChain[0]);
            	keyValEx.addChild(nameVarRefExpression);
            	keyValEx.addChild(sourceExpression);
                refType.addChild(keyValEx);
            	funcNode.addChild(refType, index);
            } else {
                funcNode.addChild(sourceExpression, index);
            }
            return assignmentStmtSource.id;
        }

        if (connection.isSourceFunction && !_.isUndefined(targetStruct)) {
            // Connection source is not a struct and target is a struct.
            // Source is a function node.
            const assignmentStmtTarget = self.findEnclosingAssignmentStatement(connection.sourceReference.id);
            let index = _.findIndex(self.getFunctionDefinition(
                                                    connection.sourceReference.getRightExpression()).getReturnParams(),
                                                            (param) => {
                                                                return param.name == connection.sourceStruct});
            assignmentStmtTarget.getLeftExpression().addChild(targetExpression, index);
            return assignmentStmtTarget.id;
        }

        // Connection source and target are not structs
        // Source and target are function nodes.

        // target reference might be function invocation expression or assignment statement
        // based on how the nested invocation is drawn. i.e. : adding two function nodes and then drawing
        // will be different from removing a param from a function and then drawing the connection
        // to the parent function invocation.
        const assignmentStmtTarget = self.getParentAssignmentStmt(connection.targetReference);

        const assignmentStmtSource = connection.sourceReference;
        let funcNode = assignmentStmtTarget.getRightExpression();

        let index = _.findIndex(self.getFunctionDefinition(funcNode).getParameters(), param => {
            const paramName = param.name || param.fieldName;
            return param.name === (connection.targetProperty || connection.targetStruct);
        });
        funcNode.children[index] = assignmentStmtSource.getRightExpression();

        //remove the source assignment statement since it is now included in the target assignment statement.
        this.props.model.removeChild(assignmentStmtSource);

        return assignmentStmtTarget.id;
    };


    onDisconnectionCallback(connection) {
        // on removing a connection
        const sourceStruct = _.find(this.predefinedStructs, { name: connection.sourceStruct });
        const targetStruct = _.find(this.predefinedStructs, { name: connection.targetStruct });

        debugger;

        if (!_.isUndefined(sourceStruct) && !connection.isSourceFunction &&
            !_.isUndefined(targetStruct) && !connection.isTargetFunction) {
            const assignmentStmt = _.find(this.props.model.children, { id: connection.id });
            this.props.model.removeChild(assignmentStmt);
            return;
        }

        if (!_.isUndefined(sourceStruct) && connection.isTargetFunction) {
            // Connection source is not a struct and target is a struct.
            // Source is a function node.
            // get the function invocation expression for nested and single cases.
            let funcInvocationExpression = connection.targetFuncInv;

            const expression = _.find(funcInvocationExpression.getChildren(), (child) => {
                return (child.getExpressionString().trim() === (connection.sourceProperty || connection.sourceStruct));
            });
            funcInvocationExpression.removeChild(expression);
            return;
        }

        if (connection.isSourceFunction && !_.isUndefined(targetStruct)) {
            // Connection target is not a struct and source is a struct.
            // Target could be a function node.
            const assignmentStmtTarget = connection.sourceReference;
            const expression = _.find(assignmentStmtTarget.getLeftExpression().getChildren(), (child) => {
                return (child.getExpressionString().trim() === (connection.targetProperty || connection.targetStruct));
            });
            assignmentStmtTarget.getLeftExpression().removeChild(expression);
            return;
        }

        // Connection source and target are not structs
        // Source and target could be function nodes.
        const targetFuncInvocationExpression = connection.targetFuncInv;
        const sourceFuncInvocationExpression = connection.sourceFuncInv;

        targetFuncInvocationExpression.removeChild(sourceFuncInvocationExpression);
    };

    recordSourceElement(element, id, input) {
        if(!element || element.isSource){
            return;
        }
        this.sourceElements[id] = {element, input};
    }

    recordTargetElement(element, id, output) {
        if(!element || element.isTarget){
            return;
        }
        this.targetElements[id] = {element, output};
    }

    getStructAccessNode(name, property, isStruct) {
        if (!isStruct) {
            let simpleVarRefExpression = BallerinaASTFactory.createSimpleVariableReferenceExpression();
            simpleVarRefExpression.setExpressionFromString(name);
            return simpleVarRefExpression;
        } else {
            let fieldVarRefExpression = BallerinaASTFactory.createFieldBasedVarRefExpression();
            fieldVarRefExpression.setExpressionFromString(property);
            return fieldVarRefExpression;
        }
    }


    createConnection(statement) {
        const viewId = this.props.model.getID();

        if (BallerinaASTFactory.isCommentStatement(statement)) {
            return;
        }

        if (!BallerinaASTFactory.isAssignmentStatement(statement)) {
            log.error('Invalid statement type in transform statement');
            return;
        }

        // There can be multiple left expressions.
        // E.g. : e.name, e.username = p.first_name;
        const leftExpression = statement.getLeftExpression();
        const rightExpression = statement.getRightExpression();

        if (BallerinaASTFactory.isFieldBasedVarRefExpression(rightExpression) ||
              BallerinaASTFactory.isSimpleVariableReferenceExpression(rightExpression)) {
            _.forEach(leftExpression.getChildren(), (expression) => {
                const sourceId = `${rightExpression.getExpressionString().trim()}:${viewId}`;
                const targetId = `${leftExpression.getExpressionString().trim()}:${viewId}`;
                this.mapper.addConnection(sourceId, targetId);
            });
        }

        if (BallerinaASTFactory.isFunctionInvocationExpression(rightExpression)) {
            this.drawFunctionInvocationExpression(leftExpression, rightExpression, statement);
        }
    }

    drawFunctionDefinitionNodes(functionInvocationExpression, statement) {
        const func = this.getFunctionDefinition(functionInvocationExpression);
        if (_.isUndefined(func)) {
            alerts.error(
                'Function definition for "' + functionInvocationExpression.getFunctionName() + '" cannot be found');
            return;
        }

        if (func.getParameters().length !== functionInvocationExpression.getChildren().length) {
            alerts.warn('Function inputs and mapping count does not match in "' + func.getName() + '"');
        } else {
            const funcTarget = this.getConnectionProperties('target', functionInvocationExpression);
            _.forEach(functionInvocationExpression.getChildren(), (expression) => {
                if (BallerinaASTFactory.isFunctionInvocationExpression(expression)) {
                    this.drawInnerFunctionDefinitionNodes(functionInvocationExpression, expression, statement);
                }
            });
        }

        // Removing this node means removing the assignment statement from the transform statement,
        // since this is the top most invocation.
        // Hence passing the assignment statement as remove reference.
        // this.mapper.addFunction(func, functionInvocationExpression,
        //     statement.getParent().removeChild.bind(statement.getParent()), statement);
    }

    drawInnerFunctionDefinitionNodes(parentFunctionInvocationExpression, functionInvocationExpression, statement) {
        const func = this.getFunctionDefinition(functionInvocationExpression);
            if (_.isUndefined(func)) {
                alerts.error(
                    'Function definition for "' + functionInvocationExpression.getFunctionName() + '" cannot be found');
                return;
        }

        if (func.getParameters().length !== functionInvocationExpression.getChildren().length) {
            alerts.warn('Function inputs and mapping count does not match in "' + func.getName() + '"');
        } else {
            const funcTarget = this.getConnectionProperties('target', functionInvocationExpression);
            _.forEach(functionInvocationExpression.getChildren(), (expression) => {
                if (BallerinaASTFactory.isFunctionInvocationExpression(expression)) {
                    this.drawInnerFunctionDefinitionNodes(functionInvocationExpression, expression, statement);
                }
            });
        }

        //Removing this node means removing the function invocation from the parent function invocation.
        //Hence passing the current function invocation as remove reference.
        this.mapper.addFunction(
            func, functionInvocationExpression,
            parentFunctionInvocationExpression.removeChild.bind(parentFunctionInvocationExpression),
            functionInvocationExpression);
    }

    drawInnerFunctionInvocationExpression(parentFunctionInvocationExpression, functionInvocationExpression,
                                          parentFunctionDefinition, parentParameterIndex, statement) {
        const viewId = this.props.model.getID();
        const func = this.getFunctionDefinition(functionInvocationExpression);
        if (_.isUndefined(func)) {
            alerts.error(
                'Function definition for "' + functionInvocationExpression.getFunctionName() + '" cannot be found');
            return;
        }

        if (func.getParameters().length !== functionInvocationExpression.getChildren().length) {
            alerts.warn('Function inputs and mapping count does not match in "' + func.getName() + '"');
        }

        const params = func.getParameters();
        const returnParams = func.getReturnParams();
        const packageName = functionInvocationExpression.getFullPackageName();
        const funcName = functionInvocationExpression.getFunctionName();

        _.forEach(functionInvocationExpression.getChildren(), (expression, i) => {
            if (BallerinaASTFactory.isFunctionInvocationExpression(expression)) {
                this.drawInnerFunctionInvocationExpression(
                    functionInvocationExpression, expression, func, i, statement);
            } else {
                const sourceId = `${expression.getExpressionString().trim()}:${viewId}`;
                const targetId = `${packageName}:${funcName}:${params[i].name}:${viewId}`;
                this.mapper.addConnection(sourceId, targetId);
            }
        });

        if (!parentFunctionDefinition) {
            return;
        }

        const sourceId = `${packageName}:${funcName}:${returnParams[0].name || 0}:${viewId}`;
        this.mapper.addConnection(sourceId, targetId);

        const parentParams = parentFunctionDefinition.getParameters();
        const parentPackageName = parentFunctionInvocationExpression.getFullPackageName();
        const parentFuncName = parentFunctionInvocationExpression.getFunctionName();

        const targetId = `${parentPackageName}:${parentFuncName}:${parentParams[parentParameterIndex].name}:${viewId}`;

        this.mapper.addConnection(sourceId, targetId);
    }

    drawFunctionInvocationExpression(argumentExpressions, functionInvocationExpression, statement) {
        const func = this.getFunctionDefinition(functionInvocationExpression);
        const viewId = this.props.model.getID();
        if (_.isUndefined(func)) {
            alerts.error(
                'Function definition for "' + functionInvocationExpression.getFunctionName() + '" cannot be found');
            return;
        }
        if (func.getParameters().length !== functionInvocationExpression.getChildren().length) {
            alerts.warn('Function inputs and mapping count does not match in "' + func.getName() + '"');
        }

        const params = func.getParameters();
        const returnParams = func.getReturnParams();
        const packageName = functionInvocationExpression.getFullPackageName();
        const funcName = functionInvocationExpression.getFunctionName();

        _.forEach(functionInvocationExpression.getChildren(), (expression, i) => {
            if (BallerinaASTFactory.isFunctionInvocationExpression(expression)) {
                this.drawInnerFunctionInvocationExpression(
                    functionInvocationExpression, expression, func, i, statement);
            } else {
                let target;
                let source;
                if (BallerinaASTFactory.isKeyValueExpression(expression.children[0])) {
                //if parameter is a key value expression, iterate each expression and draw connections
                _.forEach(expression.children, (propParam) => {
                    source = this.getConnectionProperties('source', propParam.children[1]);
                    target = this.getConnectionProperties('target', func.getParameters()[i]);
                    _.merge(target, funcTarget); // merge parameter props with function props
                    target.targetProperty.push(propParam.children[0].getVariableName());
                    let typeDef = _.find(this.predefinedStructs, { typeName: func.getParameters()[i].type});
                    let propType = _.find(typeDef.properties, { name: propParam.children[0].getVariableName()});
                    target.targetType.push(propType.type);
                    this.drawConnection(statement.getID() + functionInvocationExpression.getID(), source, target);
                });
                } else {
                    const sourceId = `${expression.getExpressionString().trim()}:${viewId}`;
                    const targetId = `${packageName}:${funcName}:${params[i].name}:${viewId}`;
                    this.mapper.addConnection(sourceId, targetId);
                }
            }
        });

        if (func.getReturnParams().length !== argumentExpressions.getChildren().length) {
            alerts.warn('Function inputs and mapping count does not match in "' + func.getName() + '"');
        }

        _.forEach(argumentExpressions.getChildren(), (expression, i) => {
            const sourceId = `${packageName}:${funcName}:${returnParams[i].name || i}:${viewId}`;
            const targetId = `${expression.getExpressionString().trim()}:${viewId}`
            this.mapper.addConnection(sourceId, targetId);
        });
    }

    getConnectionProperties(type, expression) {
        const con = {};
        if (BallerinaASTFactory.isFieldBasedVarRefExpression(expression)) {
            const structVarRef = expression.getStructVariableReference();
            con[type + 'Struct'] = structVarRef.getVariableName();
            const complexProp = this.createComplexProp(con[type + 'Struct'], structVarRef.getParent());
            con[type + 'Type'] = complexProp.types;
            con[type + 'Property'] = complexProp.names;
        } else if (BallerinaASTFactory.isFunctionInvocationExpression(expression)) {
            con[type + 'Function'] = true;
            if (_.isNull(expression.getPackageName())) {
                // for current package, where package name is null
                const packageName = expression.getFullPackageName().replace(' ', '');
                con[type + 'Struct'] = packageName + '-' + expression.getFunctionName();
            } else {
                const packageName = expression.getPackageName().replace(' ', '');
                con[type + 'Struct'] = packageName + '-' + expression.getFunctionName();
            }
            con[type + 'Id'] = expression.getID();
        } else if (BallerinaASTFactory.isSimpleVariableReferenceExpression(expression)) {
            con[type + 'Struct'] = expression.getVariableName();
            const varRef = _.find(this.predefinedStructs, { name: expression.getVariableName() });
            if (!_.isUndefined(varRef)) {
                con[type + 'Type'] = [varRef.type];
            }
            con[type + 'Property'] = [expression.getVariableName()];
        } else if (['name', 'type'].every(prop => prop in expression)) {
            con[type + 'Property'] = [expression.name];
            con[type + 'Type'] = [expression.type];
        } else if (_.has(expression, 'type')) {
            con[type + 'Property'] = [undefined];
            con[type + 'Type'] = [expression.type];
        } else {
            log.error('Unknown type to define connection properties');
        }
        return con;
    }

    drawConnection(id, source, target) {
        let sourceProp;
        let targetProp;
        let sourceParent = source.sourceStruct;
        let targetParent =target.targetStruct;

        if(source.sourceProperty.length > 1) {
          sourceParent = source.sourceProperty[source.sourceProperty.length  - 2];
        }
        if(target.targetProperty.length > 1) {
          targetParent = target.targetProperty[target.targetProperty.length - 2]
        }
        _.forEach(this.predefinedStructs, (struct) => {
            if (struct.name === sourceParent) {
              sourceProp = _.find(struct.properties, (field) => {
                  return field.name === source.sourceProperty[source.sourceProperty.length - 1];
              });
              if(_.isUndefined(sourceProp)) {
                sourceProp = struct;
              }
            } else if (struct.name === targetParent){
               targetProp = _.find(struct.properties, (field) => {
                  return field.name === target.targetProperty[target.targetProperty.length - 1];
              });
              if(_.isUndefined(targetProp)) {
                targetProp = struct;
              }
            }
        });
        const con = { id: id, input:sourceProp, output:targetProp};
        _.merge(con, source, target);
        this.mapper.addConnection(con);
    }

    /**
     * @param {any} UUID of an assignment statement
     * @returns {AssignmentStatement} assignment statement for maching ID
     *
     * @memberof TransformStatementDecorator
     */
    findExistingAssignmentStatement(id) {
        return _.find(this.props.model.getChildren(), (child) => {
            return child.getID() === id;
        });
    }

    /**
    *
    * Gets the enclosing assignment statement.
    *
    * @param {any} expression
    * @returns {AssignmentStatement} enclosing assignment statement
    * @memberof TransformStatementDecorator
    */
    getParentAssignmentStmt(node) {
        if (BallerinaASTFactory.isAssignmentStatement(node)){
            return node;
        } else {
            return this.getParentAssignmentStmt(node.getParent());
        }
    }

    /**
     * @param {any} UUID of a function invocation statement
     * @returns {AssignmentStatement} enclosing assignment statement containing the matching function
     * invocation statement ID
     *
     * @memberof TransformStatementDecorator
     */
    findEnclosingAssignmentStatement(id) {
        let assignmentStmts = this.props.model.getChildren();
        let assignmentStmt = this.findExistingAssignmentStatement(id);
        if (assignmentStmt === undefined) {
            return _.find(assignmentStmts, (assignmentStmt) => {
                let expression = this.findFunctionInvocationById(assignmentStmt, id);
                if (expression !== undefined) {
                    return assignmentStmt;
                }
            });
        } else {
            return assignmentStmt;
        }
    }

    findFunctionInvocationById(expression, id) {
        let found = expression.getChildById(id);
        if (found !== undefined) {
            return found;
        } else {
            _.forEach(expression.getChildren(), (child) => {
                found = this.findFunctionInvocationById(child, id);
                if (found !== undefined) {
                    return found;
                }
            });
            return found;
        }
    }

    createComplexProp(structName, expression) {
        const prop = {};
        prop.names = [];
        prop.types = [];

        if (BallerinaASTFactory.isFieldBasedVarRefExpression(expression)) {
            const fieldName = expression.getFieldName();
            const structDef = _.find(this.predefinedStructs, { name: structName });
            if (_.isUndefined(structDef)) {
                alerts.error('Struct definition for variable "' + structName + '" cannot be found');
                return;
            }
            const structField = _.find(structDef.properties, { name: fieldName });
            if (_.isUndefined(structField)) {
                alerts.error('Struct field "' + fieldName + '" cannot be found in variable "' + structName + '"');
                return;
            }
            const structFieldType = structField.type;
            prop.types.push(structFieldType);
            prop.names.push(fieldName);

            const parentProp = this.createComplexProp(fieldName, expression.getParent());
            prop.names = [...prop.names, ...parentProp.names];
            prop.types = [...prop.types, ...parentProp.types];
        }
        return prop;
    }

    getStructDefinition(packageIdentifier, structName) {
        let _package;
        if (packageIdentifier !== undefined) {
            _package = this.context.environment.getPackageByIdentifier(packageIdentifier);
        } else {
            _package = this.context.environment.getCurrentPackage();
        }

        if (_package === undefined) {
            alerts.error('Referred package ' + packageIdentifier + ' cannot be resolved');
            return;
        }

        return _.find(_package.getStructDefinitions(), (structDef) => {
            return structName === structDef.getName();
        });
    }

    createType(name, typeName, predefinedStruct, isInner, fieldName) {
        const struct = this.getStructType(name, typeName, predefinedStruct, isInner, fieldName);
        this.predefinedStructs.push(struct);
        return struct;
    }

    getStructType(name, typeName, predefinedStruct, isInner, fieldName) {
        const struct = {};

        struct.name = name;
        struct.properties = [];
        struct.type = 'struct';
        struct.typeName = typeName;
        struct.isInner = isInner;

        _.forEach(predefinedStruct.getFields(), (field) => {
            const property = {};
            property.name = field.getName();
            property.type = field.getType();
            property.packageName = field.getPackageName();
            property.structName = name;
            property.fieldName = (fieldName || name) + `.${property.name}`

            let innerStruct = this.getStructDefinition(property.packageName, property.type);
            if (!_.isUndefined(innerStruct) && typeName !== property.type) {
                property.innerType = this.createType(property.name, property.type, innerStruct, true, property.fieldName);
            }

            struct.properties.push(property);
        });
        return struct;
    }

    componentDidUpdate(prevProps) {
        this.predefinedStructs = [];
        this.getSourcesAndTargets();

        const sourceKeys = Object.keys(this.sourceElements);
        sourceKeys.forEach(key => {
            const {element, input} = this.sourceElements[key];
            input.id = key;
            this.mapper.addSource(element, null, null, input);
        });

        const targetKeys = Object.keys(this.targetElements);
        targetKeys.forEach(key => {
            const {element, output} = this.targetElements[key];
            output.id = key;
            this.mapper.addTarget(element, null, output);
        });

        this.mapper.reposition(this.mapper);

        if(this.props.model === prevProps.model) {
            return;
        }

        const nextProps = this.props;
        this.mapper.disconnectAll();

        this.predefinedStructs = [];
        this.getSourcesAndTargets();

        _.forEach(nextProps.model.getChildren(), (statement) => {
            this.createConnection(statement);
        });
    }

    componentDidMount() {
        this.mapper = new TransformRender(this.onConnectionCallback.bind(this),
            this.onDisconnectionCallback.bind(this), $(this.transformOverlayContentDiv));

        const sourceKeys = Object.keys(this.sourceElements);
        sourceKeys.forEach(key => {
            const {element, input} = this.sourceElements[key];
            this.mapper.addSource(element, null, null, input);
        });

        const targetKeys = Object.keys(this.targetElements);
        targetKeys.forEach(key => {
            const {element, output} = this.targetElements[key];
            this.mapper.addTarget(element, null, output);
        });

        _.forEach(this.props.model.getChildren(), (statement) => {
            this.createConnection(statement);
        });

        this.mapper.reposition(this.mapper);

        $(this.transformOverlayContentDiv).find('.leftType, .rightType, .middle-content').on('scroll', () => {
            this.mapper.reposition(this.mapper);
        });
    }

    onTransformDropZoneActivate(e) {
        const dragDropManager = this.context.dragDropManager;
        const dropTarget = this.props.model;
        const model = this.props.model;

        if (dragDropManager.isOnDrag()) {
            if (_.isEqual(dragDropManager.getActivatedDropTarget(), dropTarget)) {
                return;
            }
            dragDropManager.setActivatedDropTarget(dropTarget,
                (nodeBeingDragged) => {
                    // This drop zone is for assignment statements only.
                    // Functions with atleast one return parameter is allowed to be dropped. If the dropped node
                    // is an Assignment Statement, that implies there is a return parameter . If there is no
                    // return parameter, then it is a Function Invocation Statement, which is validated with below check.
                    return model.getFactory().isAssignmentStatement(nodeBeingDragged);
                },
                () => {
                    return dropTarget.getChildren().length;
                });
        }
        e.stopPropagation();
    }

    onTransformDropZoneDeactivate(e) {
        const dragDropManager = this.context.dragDropManager;
        const dropTarget = this.props.model.getParent();
        if (dragDropManager.isOnDrag()) {
            if (_.isEqual(dragDropManager.getActivatedDropTarget(), dropTarget)) {
                dragDropManager.clearActivatedDropTarget();
                this.setState({ innerDropZoneActivated: false, innerDropZoneDropNotAllowed: false });
            }
        }
        e.stopPropagation();
    }

    onSourceInputChange(e, {newValue}) {
        this.setState({
            typedSource: newValue,
        });
    }

    onTargetInputChange(e, {newValue}) {
        this.setState({
            typedTarget: newValue,
        });
    }

    onSourceSelect(e, {suggestionValue}) {
        this.setState({
            selectedSource: suggestionValue,
        });
    }

    onTargetSelect(e, {suggestionValue}) {
        this.setState({
            selectedTarget: suggestionValue,
        });
    }

    onSourceInputEnter() {
        this.addSource(this.state.typedSource);
    }

    onTargetInputEnter() {
        this.addTarget(this.state.typedTarget);
    }

    onSourceAdd() {
        this.addSource(this.state.selectedSource);
    }

    onTargetAdd() {
        this.addTarget(this.state.selectedTarget);
    }

    addSource(selectedSource) {
        let inputDef = BallerinaASTFactory
                                .createSimpleVariableReferenceExpression({ variableName: selectedSource });
        if (this.setSource(selectedSource, this.predefinedStructs, this.props.model, inputDef.id)) {
            let inputs = this.props.model.getInput();
            inputs.push(inputDef);
            this.props.model.setInput(inputs);
            this.setState({typedSource: ''});
        }
    }

    addTarget(selectedTarget) {
        let outDef = BallerinaASTFactory
                                .createSimpleVariableReferenceExpression({ variableName: selectedTarget });
        if (this.setTarget(selectedTarget, this.predefinedStructs, this.props.model, outDef.id)) {
            let outputs = this.props.model.getOutput();
            outputs.push(outDef);
            this.props.model.setOutput(outputs);
            this.setState({typedTarget: ''});
        }
    }

    onClose() {
        const { designView } = this.context;
        designView.setTransformActive(false);
    }

    getTransformVarJson(args) {
        const argArray = [];
        _.forEach(args, (argument) => {
            if (BallerinaASTFactory.isVariableDefinitionStatement(argument)) {
                const arg = {
                    id: argument.getID(),
                    type: argument.getVariableType(),
                    name: argument.getVariableDef().getName(),
                    pkgName: argument.getVariableDef().getPkgName(),
                    constraint: argument.getVariableDef().getTypeConstraint(),
                };
                argArray.push(arg);
            } else if (BallerinaASTFactory.isParameterDefinition(argument)) {
                const arg = {
                    id: argument.getID(),
                    type: argument.getTypeName(),
                    name: argument.getName(),
                    pkgName: argument.getPkgName(),
                    constraint: argument.getTypeConstraint(),
                };
                argArray.push(arg);
            }
        });
        return argArray;
    }

    getSourcesAndTargets() {
        const variables = this.props.model.filterChildrenInScope(
                                     this.props.model.getFactory().isVariableDefinitionStatement)
        const argHolders = this.props.model.filterChildrenInScope(
                                     this.props.model.getFactory().isArgumentParameterDefinitionHolder)
        const paramArgs = [];
        _.forEach(argHolders, (argHolder) => {
            _.forEach(argHolder.getChildren(), (arg) => {
                paramArgs.push(arg);
            });
        });

        const transformVars = this.getTransformVarJson(variables.concat(paramArgs));
        const items = [];

        _.forEach(transformVars, (arg) => {
            let isStruct = false;
            const structDef = this.getStructDefinition(arg.pkgName, arg.type);

            if (structDef !== undefined) {
                arg.type = ((arg.pkgName) ? (arg.pkgName + ':') : '') + arg.type;
                const struct = this.createType(arg.name, arg.type, structDef);
                items.push({ name: struct.name, type: struct.typeName });
                isStruct = true;
            }

            if (!isStruct) {
                const variableType = {};
                variableType.id = arg.id;
                variableType.name = arg.name;
                if (arg.constraint !== undefined) {
                    variableType.type = arg.type + '<'
                                  + ((arg.constraint.pkgName) ? arg.constraint.pkgName + ':' : '')
                                  + arg.constraint.type + '>';
                    variableType.constraintType = arg.constraint;
                    const constraintDef = this.getStructDefinition(arg.constraint.pkgName, arg.constraint.type);
                    if (constraintDef !== undefined) {
                        const constraint = this.getStructType(arg.name, variableType.type, constraintDef, true);
                        // For constraint types, the field types must be the same type as the variable and
                        // not the struct field types. E.g. : struct.name type maybe string but if it is a json,
                        // type has to be json and not string. Hence converting all field types to variable type.
                        // TODO : revisit this conversion if ballerina language supports constrained field access to be
                        // be treated as the field type (i.e. as string from the struct field and not json)
                        this.convertFieldType(constraint.properties, arg.type);

                        // constraint properties (fields) become variable fields
                        variableType.properties = constraint.properties;
                        variableType.constraint = constraint;
                    }
                } else {
                    variableType.type = arg.type;
                }
                this.predefinedStructs.push(variableType);
                items.push({ name: variableType.name, type: variableType.type });
            }
        });

        return items;
    }

    /**
     * Converts the property types to a given type
     * @param {[Property]} properties properties
     * @param {string} type type to convert to
     * @memberof TransformExpanded
     */
    convertFieldType(properties, type) {
        if (properties) {
            properties.forEach((property) => {
                if (property.innerType) {
                    this.convertFieldType(property.innerType.properties, type);
                }
                property.type = type;
            });
        }
    }

    setSource(currentSelection, predefinedStructs) {
        var sourceSelection =  _.find(predefinedStructs, { name:currentSelection });
        if (_.isUndefined(sourceSelection)){
            alerts.error('Mapping source "' + currentSelection + '" cannot be found');
            return false;
        }

        // const removeFunc = id => {
        //     this.mapper.removeType(id);
        //     _.remove(this.props.model.getInput(),(currentObject) => {
        //         return currentObject.getVariableName() === id;
        //     });
        //     this.removeAssignmentStatements(id, "source");
        //     this.props.model.setInput(this.props.model.getInput());
        //     var currentSelectionObj =  _.find(this.predefinedStructs, { name:id});
        //     currentSelectionObj.added = false;
        // }
        //
        // if (!sourceSelection.added) {
        //     if (sourceSelection.type === 'struct') {
        //         this.mapper.addSourceType(sourceSelection, removeFunc);
        //     } else if (sourceSelection.constraint !== undefined) {
        //         this.mapper.addSourceType(sourceSelection.constraint, removeFunc);
        //     } else {
        //         this.mapper.addVariable(sourceSelection, 'source', removeFunc);
        //     }
        //     sourceSelection.added = true;

        return true;

    }

    setTarget(currentSelection, predefinedStructs) {
        var targetSelection = _.find(predefinedStructs, { name: currentSelection});
        if (_.isUndefined(targetSelection)){
            alerts.error('Mapping target "' + currentSelection + '" cannot be found');
            return false;
        }

        // const removeFunc = id => {
        //     this.mapper.removeType(id);
        //     _.remove(this.props.model.getOutput(),(currentObject) => {
        //         return currentObject.getVariableName() === id;
        //     });
        //     this.removeAssignmentStatements(id, "target");
        //     this.props.model.setOutput(this.props.model.getOutput());
        //     var currentSelectionObj =  _.find(this.predefinedStructs, { name:id});
        //     currentSelectionObj.added = false;
        // }
        //
        // if (!targetSelection.added) {
        //     if (targetSelection.type === 'struct') {
        //         this.mapper.addTargetType(targetSelection, removeFunc);
        //     } else if (targetSelection.constraint !== undefined) {
        //         this.mapper.addTargetType(targetSelection.constraint, removeFunc);
        //     } else {
        //         this.mapper.addVariable(targetSelection, 'target', removeFunc);
        //     }
        //     targetSelection.added = true;
        //     return true;
        // }
        //
        // return false;

        return true;
    }

    removeAssignmentStatements(id, type) {
        const statementsToRemove = [];

        this.props.model.getChildren().forEach(currentObject => {
            let nodeToRemove;

            if(type === "source") {
                nodeToRemove = currentObject.getRightExpression();
            } else {
                nodeToRemove = currentObject.getLeftExpression();
            }

            if (nodeToRemove.getFactory().isFieldBasedVarRefExpression(nodeToRemove)) {
                if(nodeToRemove.getExpressionString().startsWith(`${id}.`)){
                    statementsToRemove.push(currentObject);
                    return;
                }
            }

            if ((nodeToRemove.getFactory().isVariableReferenceList(nodeToRemove))) {
                nodeToRemove.getChildren().forEach(childVarRef => {
                    if (nodeToRemove.getFactory().isFieldBasedVarRefExpression(childVarRef)) {
                        if(childVarRef.getExpressionString().startsWith(`${id}.`)){
                            statementsToRemove.push(currentObject);
                            return;
                        }
                    }

                    if(childVarRef.getVariableName() === id) {
                        statementsToRemove.push(currentObject);
                        return;
                    }
                });
                return;
            }

            if(nodeToRemove.getVariableName() === id) {
                statementsToRemove.push(currentObject);
            }
        });

        statementsToRemove.forEach(statement => {
            this.props.model.removeChild(statement);
        })
    }

    findFunctionInvocations(functionInvocationExpression, functions=[], parentFunc) {
        const func = this.getFunctionDefinition(functionInvocationExpression);
        if (_.isUndefined(func)) {
            alerts.error('Function definition for "' +
                functionInvocationExpression.getFunctionName() + '" cannot be found');
            return;
        }
        functionInvocationExpression.getChildren().forEach(child => {
            if(BallerinaASTFactory.isFunctionInvocationExpression(child)) {
                this.findFunctionInvocations(child, functions, functionInvocationExpression);
            }
        });
        functions.push({func, parentFunc, funcInv: functionInvocationExpression});
        return functions;
    }

    render() {
        const sourceId = 'sourceStructs' + this.props.model.id;
        const targetId = 'targetStructs' + this.props.model.id;
        const sourcesAndTargets = this.predefinedStructs.filter(endpoint => (!endpoint.isInner));
        const inputNodes = this.props.model.getInput();
        const outputNodes = this.props.model.getOutput();
        const children = this.props.model.getChildren();

        const inputs = [];
        inputNodes.forEach(inputNode => {
            const name = inputNode.getVariableName();
            const sourceSelection = _.find(this.predefinedStructs, { name });
            if (_.isUndefined(sourceSelection)) {
                alerts.error('Mapping source "' + name + '" cannot be found');
                return;
            }
            inputs.push(sourceSelection);
        });

        const outputs = [];
        outputNodes.forEach(outputNode => {
            const name = outputNode.getVariableName();
            const targetSelection = _.find(this.predefinedStructs, { name });
            if (_.isUndefined(targetSelection)) {
                alerts.error('Mapping target "' + name + '" cannot be found');
                return;
            }

            outputs.push(targetSelection);
        });

        const functions = [];
        this.props.model.getChildren().forEach(child => {
            if(!BallerinaASTFactory.isAssignmentStatement(child)) {
                return;
            }
            const rightExpression = child.getRightExpression();

            if(BallerinaASTFactory.isFunctionInvocationExpression(rightExpression)) {
                const funcInvs = this.findFunctionInvocations(rightExpression);
                funcInvs.forEach(funcDetails => {funcDetails.assignmentStmt = child});
                functions.push(...funcInvs);
            }
        });

        return (
                <div id={`transformOverlay-content-${this.props.model.getID()}`} className='transformOverlay'
                    ref={div => this.transformOverlayContentDiv=div }
                    onMouseOver={this.onTransformDropZoneActivate}
                    onMouseOut={this.onTransformDropZoneDeactivate}>
                    <div id ="transformHeader" className="transform-header">
                        <i onClick={this.onClose} className="fw fw-left icon close-transform"></i>
                        <p className="transform-header-text ">
                            <i className="transform-header-icon fw fw-type-converter"></i>
                            Transform
                        </p>
                    </div>
                    <div className='left-content'>
                        <div className="select-source">
                            <SuggestionsDropdown
                                value={this.state.typedSource}
                                onChange={this.onSourceInputChange}
                                onEnter={this.onSourceInputEnter}
                                suggestionsPool={sourcesAndTargets}
                                placeholder='Select Source'
                                onSuggestionSelected={this.onSourceSelect}
                            />
                            <span
                                className="btn-add-source fw-stack fw-lg btn btn-add"
                                onClick={this.onSourceAdd}
                            >
                                <i className="fw fw-add fw-stack-1x"></i>
                            </span>
                        </div>
                        <div className="leftType">
                            <Tree viewId={this.props.model.getID()} endpoints={inputs} type='source' makeConnectPoint={this.recordSourceElement} />
                        </div>
                    </div>
                    <div className="middle-content">
                        {
                            functions.map(({func, assignmentStmt, parentFunc, funcInv}) => (
                                <FunctionInv
                                    key={func.getId()}
                                    func={func}
                                    enclosingAssignmentStatement={assignmentStmt}
                                    parentFunc={parentFunc}
                                    funcInv={funcInv}
                                    recordSourceElement={this.recordSourceElement}
                                    recordTargetElement={this.recordTargetElement}
                                    viewId={this.props.model.getID()}
                                />
                            ))
                        }
                    </div>
                    <div className='right-content'>
                        <div className="select-target">
                            <SuggestionsDropdown
                                value={this.state.typedTarget}
                                onChange={this.onTargetInputChange}
                                onEnter={this.onTargetInputEnter}
                                suggestionsPool={sourcesAndTargets}
                                placeholder='Select Target'
                                onSuggestionSelected={this.onTargetSelect}
                            />
                            <span
                                className="btn-add-source fw-stack fw-lg btn btn-add"
                                onClick={this.onTargetAdd}
                            >
                                <i className="fw fw-add fw-stack-1x"></i>
                            </span>
                        </div>
                        <div className="rightType">
                            <Tree viewId={this.props.model.getID()} endpoints={outputs} type='target' makeConnectPoint={this.recordTargetElement}/>
                        </div>
                    </div>
                    <div id ="transformContextMenu" className="transformContextMenu"></div>
                    <div id ="transformFooter" className="transform-footer"></div>
                </div>
        );
    }
}

TransformExpanded.propTypes = {
    model: PropTypes.instanceOf(ASTNode).isRequired,
};

TransformExpanded.contextTypes = {
    dragDropManager: PropTypes.instanceOf(DragDropManager).isRequired,
    designView: PropTypes.instanceOf(Object).isRequired,
    environment: PropTypes.instanceOf(Object).isRequired,
};

export default TransformExpanded;



// WEBPACK FOOTER //
// ./js/ballerina/components/transform-expanded.jsx


// WEBPACK FOOTER //
// ./js/ballerina/components/transform-expanded.jsx
